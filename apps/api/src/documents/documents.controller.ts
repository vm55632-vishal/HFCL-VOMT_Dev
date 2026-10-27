import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { PERMISSIONS } from '@vop/shared';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { RequirePermissions } from '../authz/permissions.decorator';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DocumentsService } from './documents.service';

const removeSchema = z.object({
  ids: z
    .array(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Invalid file id.'))
    .min(1)
    .max(100),
});

// Hard cap for the multipart parser; the configurable business limit is enforced in the service.
const HARD_LIMIT_BYTES = 25 * 1024 * 1024;

@ApiTags('documents')
@Controller('cases/:caseId/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.DocumentUpload)
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: HARD_LIMIT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document to a case (magic-byte + malware scanned)' })
  upload(
    @CurrentUser() actor: AuthUser,
    @Param('caseId') caseId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('docType') docType: string,
    @Body('expiryDate') expiryDate?: string,
    @Body('source') source?: string,
    @Body('comment') comment?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided.');
    if (!docType) throw new BadRequestException('docType is required.');
    return this.documents.upload(
      actor,
      caseId,
      docType,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      expiryDate,
      { source, comment },
    );
  }

  @Get()
  @ApiOperation({ summary: 'List documents on a case' })
  list(@CurrentUser() actor: AuthUser, @Param('caseId') caseId: string) {
    return this.documents.list(actor, caseId);
  }

  @Post('remove')
  @RequirePermissions(PERMISSIONS.DocumentUpload)
  @ApiOperation({ summary: 'Remove files you uploaded from an open case (audited)' })
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('caseId') caseId: string,
    @Body(new ZodValidationPipe(removeSchema)) body: z.infer<typeof removeSchema>,
  ) {
    return this.documents.remove(actor, caseId, body.ids);
  }

  @Get(':docId/download')
  @RequirePermissions(PERMISSIONS.DocumentDownload)
  @ApiOperation({ summary: 'Download a document (re-checks authorization; audited)' })
  async download(
    @CurrentUser() actor: AuthUser,
    @Param('caseId') caseId: string,
    @Param('docId') docId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType, filename } = await this.documents.download(actor, caseId, docId);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Content-Length': String(buffer.length),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(buffer);
  }
}
