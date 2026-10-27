import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ALLOWED_MIME,
  detectFileType,
  DOCUMENT_COMMENT_MAX,
  documentSourceFor,
  isDocumentSource,
  newId,
  PERMISSIONS,
} from '@vop/shared';
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

/** Files on a finished case are part of its record and cannot be removed. */
const CLOSED_STAGES = ['approved', 'rejected', 'cancelled'];

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
  source: true,
  comment: true,
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

  private async caseAndAuthz(actor: AuthUser, caseId: string): Promise<{ stage: string }> {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { createdById: true, onBehalfOfId: true, assigneeId: true, stage: true },
    });
    if (!c) throw new NotFoundException('Case not found.');
    if (actor.permissions.has(PERMISSIONS.VendorReadAll)) return c;
    if (isCaseOwner(c, actor.id) || c.assigneeId === actor.id) return c;
    throw new ForbiddenException('Not authorized for this case.');
  }

  /** A file can be removed only by the person who uploaded it, while the case is still open. */
  private canRemove(actor: AuthUser, stage: string, uploadedById: string): boolean {
    return (
      actor.permissions.has(PERMISSIONS.DocumentUpload) &&
      !CLOSED_STAGES.includes(stage) &&
      uploadedById === actor.id
    );
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
    meta: { source?: string; comment?: string } = {},
  ) {
    await this.caseAndAuthz(actor, caseId);
    if (meta.source && !isDocumentSource(meta.source)) {
      throw new BadRequestException('Unknown upload source.');
    }
    const comment = meta.comment?.trim() || null;
    if (comment && comment.length > DOCUMENT_COMMENT_MAX) {
      throw new BadRequestException(`The comment can be up to ${DOCUMENT_COMMENT_MAX} characters.`);
    }

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
        source: documentSourceFor(docType, meta.source),
        comment,
        uploadedById: actor.id,
      },
      select: META_SELECT,
    });

    await this.audit.append({
      action: 'document.upload',
      entityType: 'Document',
      entityId: doc.id,
      actorId: actor.id,
      detail: {
        caseId,
        docType,
        sha256,
        sizeBytes: file.buffer.length,
        version: doc.version,
        source: doc.source,
      },
    });
    return doc;
  }

  async list(actor: AuthUser, caseId: string) {
    const { stage } = await this.caseAndAuthz(actor, caseId);
    const docs = await this.prisma.document.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: META_SELECT,
    });
    // Who uploaded each file (name only), and where from: older uploads get a source by type.
    const ids = [...new Set(docs.map((d) => d.uploadedById))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return docs.map((d) => ({
      ...d,
      source: documentSourceFor(d.docType, d.source),
      uploadedByName: names.get(d.uploadedById) ?? null,
      canRemove: this.canRemove(actor, stage, d.uploadedById),
    }));
  }

  /**
   * Remove files from a case: all of them or none. Each must be on this case and removable by the
   * actor (their own upload, case still open). The rows go first, then the stored bytes; every
   * removal is audited with the file's hash so the record of what existed survives.
   */
  async remove(actor: AuthUser, caseId: string, ids: string[]) {
    const { stage } = await this.caseAndAuthz(actor, caseId);
    const docs = await this.prisma.document.findMany({
      where: { id: { in: ids }, caseId },
      select: { id: true, docType: true, sha256: true, storageKey: true, uploadedById: true },
    });
    if (docs.length !== new Set(ids).size) throw new NotFoundException('File not found.');
    if (CLOSED_STAGES.includes(stage)) {
      throw new ForbiddenException('Files on a finished case cannot be removed.');
    }
    if (docs.some((d) => !this.canRemove(actor, stage, d.uploadedById))) {
      throw new ForbiddenException('You can only remove files you uploaded.');
    }
    await this.prisma.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) }, caseId } });
    for (const d of docs) {
      await this.audit.append({
        action: 'document.remove',
        entityType: 'Document',
        entityId: d.id,
        actorId: actor.id,
        detail: { caseId, docType: d.docType, sha256: d.sha256 },
      });
      // The row is gone, so the file can no longer be reached; a storage failure only leaves
      // an orphaned object behind.
      await this.storage.remove(d.storageKey).catch(() => undefined);
    }
    return { removed: docs.length };
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
