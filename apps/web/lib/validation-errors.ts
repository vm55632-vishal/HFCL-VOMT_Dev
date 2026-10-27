/**
 * Turns the server's field-level validation message ("partners.0.pincode: Pin code must be 6
 * digits.; references.1.email: ...") into short plain lines, and says which page of the raise-case
 * form holds the first problem so the proposer lands on it.
 */

const FIELD_LABELS: Record<string, string> = {
  // management structure (proprietor / partners / directors / Karta)
  name: 'name',
  dob: 'date of birth',
  maritalStatus: 'marital status',
  gender: 'gender',
  fatherName: "father's name",
  spouseName: 'spouse name',
  pan: 'PAN',
  address: 'residence address',
  mobile: 'mobile number',
  residencePhone: 'residence phone',
  pincode: 'pin code',
  contact: "director's contact number",
  officeAddress: "director's address",
  // references
  contactName: 'contact name',
  businessName: 'legal name of the business',
  registeredAddress: 'registered address',
  contactNumber: 'contact number',
  email: 'email ID',
  // RC limits
  financerName: 'name of the financer',
  rcLimit: 'RC limit',
  numberOfVehicles: 'number of vehicles',
};

const LIST_ROOTS: Record<string, { noun: string; step: number }> = {
  partners: { noun: 'Management structure, person', step: 3 },
  references: { noun: 'Reference', step: 3 },
  rcLimits: { noun: 'RC limit', step: 3 },
};

const STEP_BY_ROOT: Record<string, number> = {
  categoryKey: 0,
  subCategoryKey: 0,
  legalName: 0,
  tradeName: 0,
  businessAddress: 0,
  pan: 0,
  gstin: 0,
  ifsc: 0,
  bankAccount: 0,
  bankName: 0,
  branch: 0,
  teamOverrides: 1,
  proposerId: 1,
  constitution: 3,
  partners: 3,
};

const words = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

/** Returns plain-language lines and the step of the first problem, or null if this isn't a field error. */
export function explainValidation(message: string): { text: string; step: number } | null {
  const parts = message.split(/;\s+(?=[A-Za-z][\w.]*:\s)/);
  const lines: string[] = [];
  let step: number | null = null;
  for (const part of parts) {
    const m = /^([A-Za-z][\w.]*):\s(.+)$/.exec(part.trim());
    if (!m) return null;
    const path = m[1] ?? '';
    const issue = (m[2] ?? '').replace(/\.$/, '');
    const [root = '', index, field] = path.split('.');
    const list = LIST_ROOTS[root];
    let where: string;
    let s: number;
    if (list && index !== undefined && /^\d+$/.test(index)) {
      where = `${list.noun} ${Number(index) + 1}${field ? ` · ${FIELD_LABELS[field] ?? words(field)}` : ''}`;
      s = list.step;
    } else if (root === 'teamOverrides') {
      where = 'Team structure';
      s = 1;
    } else {
      where = words(root);
      s = STEP_BY_ROOT[root] ?? (/^(isec|signatory|contact)/.test(root) ? 2 : 0);
    }
    if (step === null) step = s;
    const line = `• ${where}: ${issue}.`;
    if (!lines.includes(line)) lines.push(line);
  }
  if (lines.length === 0) return null;
  const shown = lines.slice(0, 6);
  const more = lines.length - shown.length;
  return {
    text: `Please fix the following before raising the case:\n${shown.join('\n')}${more > 0 ? `\n• …and ${more} more.` : ''}`,
    step: step ?? 0,
  };
}
