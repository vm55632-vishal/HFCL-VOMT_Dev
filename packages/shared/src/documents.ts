/** Where on the platform a document was uploaded from (shown in the case's Files tab). */
export const DOCUMENT_SOURCES = [
  'vendor_form',
  'case_files',
  'fcu_review',
  'infosec_review',
  'operation_review',
  'legal_review',
  'sap_review',
  'approval',
] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const DOCUMENT_SOURCE_LABELS: Record<DocumentSource, string> = {
  vendor_form: 'Vendor form',
  case_files: 'Case files',
  fcu_review: 'FCU review',
  infosec_review: 'InfoSec review',
  operation_review: 'Operations review',
  legal_review: 'Legal review',
  sap_review: 'SAP confirmation',
  approval: 'Approval',
};

export const isDocumentSource = (v: unknown): v is DocumentSource =>
  typeof v === 'string' && (DOCUMENT_SOURCES as readonly string[]).includes(v);

/**
 * The source of a document that was uploaded without one (older uploads): the FCU report comes
 * from the FCU review and a photograph from the vendor form; anything else from the case files.
 */
export function documentSourceFor(docType: string, source?: string | null): DocumentSource {
  if (isDocumentSource(source)) return source;
  if (docType === 'fcu_dd_report') return 'fcu_review';
  if (docType.endsWith('_photo')) return 'vendor_form';
  return 'case_files';
}

/** Document types offered when uploading from the case's Files tab. */
export const CASE_FILE_TYPES = [
  'pan_card',
  'gst_certificate',
  'cancelled_cheque',
  'insurance',
  'tax_residency_certificate',
  'related_party_declaration',
  'other',
] as const;

const DOC_TYPE_LABELS: Record<string, string> = {
  pan_card: 'PAN card',
  gst_certificate: 'GST certificate',
  cancelled_cheque: 'Cancelled cheque',
  insurance: 'Insurance',
  tax_residency_certificate: 'Tax residency certificate',
  related_party_declaration: 'Related-party declaration',
  fcu_dd_report: 'FCU due-diligence report',
  karta_photo: 'Photograph of the Karta',
  other: 'Other',
};

/** A readable name for a document type ("gst_certificate" → "GST certificate"). */
export function docTypeLabel(docType: string): string {
  if (DOC_TYPE_LABELS[docType]) return DOC_TYPE_LABELS[docType];
  const s = docType.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Longest comment kept with an uploaded document. */
export const DOCUMENT_COMMENT_MAX = 500;
