import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ALLOWED_MIME, detectFileType, newId, PERMISSIONS } from '@vop/shared';
import type { AppConfig } from '@vop/config';
import { APP_CONFIG } from '../config/config.module';
import { isCaseOwner } from '../cases/case-ownership';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  STORAGE_PROVIDER,
  SCAN_PROVIDER,
  type StorageProvider,
  type ScanProvider,
} from '../providers/contracts';
import { objectKey } from '../providers/storage.adapters';
import type { AuthUser } from '../auth/auth-user';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

const META_SELECT = {
  id: true,
  docType: true,
  filename: true,
  contentType: true,
  fileType: true,
  sizeBytes: true,
  sha256: true,
  status: true,
  version: true,
  expiryDate: true,
  uploadedById: true,
  createdAt: true,
};

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(SCAN_PROVIDER) private readonly scan: ScanProvider,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async caseAndAuthz(actor: AuthUser, caseId: string): Promise<void> {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { createdById: true, onBehalfOfId: true, assigneeId: true },
    });
    if (!c) throw new NotFoundException('Case not found.');
    if (actor.permissions.has(PERMISSIONS.VendorReadAll)) return;
    if (isCaseOwner(c, actor.id) || c.assigneeId === actor.id) return;
    throw new ForbiddenException('Not authorized for this case.');
  }

  /** Display-only filename: strip any path and control chars, cap length. Never used as a key. */
  private safeName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? 'file';
    // Drop control characters (code points below 0x20) without a control-character regex.
    const printable = [...base].filter((ch) => ch.charCodeAt(0) >= 0x20).join('');
    return printable.slice(0, 200) || 'file';
  }

  async upload(
    actor: AuthUser,
    caseId: string,
    docType: string,
    file: UploadedFile,
    expiryDate?: string,
  ) {
    await this.caseAndAuthz(actor, caseId);

    if (file.buffer.length > this.config.uploads.maxBytes) {
      throw new BadRequestException('File exceeds the maximum allowed size.');
    }
    // Validate by magic bytes — not the extension or client MIME type.
    const fileType = detectFileType(file.buffer);
    if (!fileType) {
      throw new BadRequestException(
        'Only PDF, JPG or PNG files are allowed (validated by content).',
      );
    }
    // A photograph (e.g. of the Karta) must be an image.
    if (docType.endsWith('_photo') && fileType === 'pdf') {
      throw new BadRequestException('The photograph must be a JPG or PNG image.');
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    // Malware scan before anything is stored; infected content is never persisted.
    const scan = await this.scan.scan(file.buffer);
    if (!scan.clean) {
      await this.audit.append({
        action: 'document.rejected_malware',
        entityType: 'Case',
        entityId: caseId,
        actorId: actor.id,
        detail: { docType, signature: scan.signature, sha256 },
      });
      throw new BadRequestException(
        `File rejected by malware scan (${scan.signature ?? 'infected'}).`,
      );
    }

    const priorVersions = await this.prisma.document.count({ where: { caseId, docType } });
    const key = objectKey(`cases/${caseId}/${docType}`, file.buffer);
    await this.storage.put(key, file.buffer, ALLOWED_MIME[fileType]);

    const doc = await this.prisma.document.create({
      data: {
        id: newId(),
        caseId,
        docType,
        filename: this.safeName(file.originalname),
        storageKey: key,
        contentType: ALLOWED_MIME[fileType],
        fileType,
        sizeBytes: file.buffer.length,
        sha256,
        status: 'CLEAN',
        version: priorVersions + 1,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        uploadedById: actor.id,
      },
      select: META_SELECT,
    });

    await this.audit.append({
      action: 'document.upload',
      entityType: 'Document',
      entityId: doc.id,
      actorId: actor.id,
      detail: { caseId, docType, sha256, sizeBytes: file.buffer.length, version: doc.version },
    });
    return doc;
  }

  async list(actor: AuthUser, caseId: string) {
    await this.caseAndAuthz(actor, caseId);
    return this.prisma.document.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: META_SELECT,
    });
  }

  /** Stream a clean document after re-checking authorization. The download is audited. */
  async download(actor: AuthUser, caseId: string, docId: string) {
    await this.caseAndAuthz(actor, caseId);
    const doc = await this.prisma.document.findUnique({ where: { id: docId } });
    if (!doc || doc.caseId !== caseId) throw new NotFoundException('Document not found.');
    if (doc.status !== 'CLEAN') throw new ForbiddenException('Document is not available.');

    const buffer = await this.storage.get(doc.storageKey);
    await this.audit.append({
      action: 'document.download',
      entityType: 'Document',
      entityId: docId,
      actorId: actor.id,
      detail: { caseId },
    });
    return { buffer, contentType: doc.contentType, filename: doc.filename };
  }
}
