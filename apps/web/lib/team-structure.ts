/** Team structure fields, grouped as the form and the Vendor Details popup show them. */
export interface TeamFieldDef {
  key: string;
  label: string;
  /** What the value is, for validation and the card's avatar. */
  kind: 'name' | 'email' | 'text';
  /** Filled from the login and not editable (the proposer's own name and email). */
  locked?: boolean;
}

export const TEAM_GROUPS: { title: string; fields: TeamFieldDef[] }[] = [
  {
    title: 'Proposer',
    fields: [
      { key: 'proposerName', label: 'Proposer Name', kind: 'name', locked: true },
      { key: 'proposerEmail', label: 'Proposer Email', kind: 'email', locked: true },
      { key: 'proposerDepartment', label: 'Proposer Department', kind: 'text' },
    ],
  },
  {
    title: 'Head of Department',
    fields: [
      { key: 'hodName', label: 'Head Of Department (HOD) Name', kind: 'name' },
      { key: 'hodEmail', label: 'HOD Contact Email', kind: 'email' },
    ],
  },
  {
    title: 'Zonal Manager / RCM',
    fields: [
      {
        key: 'zonalManagerName',
        label: 'Zonal Manager / Regional Collection Manager Name',
        kind: 'name',
      },
      { key: 'zonalManagerEmail', label: 'Zonal Manager / RCM Email', kind: 'email' },
    ],
  },
  {
    title: 'EY Due Diligence',
    fields: [
      { key: 'eyDdName', label: 'EY Due Diligence Member (EY DD)', kind: 'name' },
      { key: 'eyDdEmail', label: 'EY DD Contact Email', kind: 'email' },
    ],
  },
  {
    title: 'HFCL Authorized Signatory Group A',
    fields: [
      {
        key: 'signatoryAName',
        label: 'HFCL Authorized Signatory Group A Contact Name',
        kind: 'name',
      },
      {
        key: 'signatoryAEmail',
        label: 'HFCL Authorized Signatory Group A Contact Email',
        kind: 'email',
      },
    ],
  },
  {
    title: 'HFCL Authorized Signatory Group B',
    fields: [
      {
        key: 'signatoryBName',
        label: 'HFCL Authorized Signatory Group B Contact Name',
        kind: 'name',
      },
      {
        key: 'signatoryBEmail',
        label: 'HFCL Authorized Signatory Group B Contact Email',
        kind: 'email',
      },
    ],
  },
  {
    title: 'SAP Team',
    fields: [
      { key: 'sapTeamName', label: 'SAP Team Name', kind: 'name' },
      { key: 'sapTeamEmail', label: 'SAP Team Email', kind: 'email' },
    ],
  },
  {
    title: 'SFDC Team',
    fields: [{ key: 'sfdcTeamEmail', label: 'SFDC Team Email', kind: 'email' }],
  },
];

/** Roles whose person is picked by email from the directory; the name follows from the email. */
export interface TeamRoleDef {
  role: string;
  label: string;
  nameKey: string | null;
  emailKey: string;
}
export const TEAM_ROLES: TeamRoleDef[] = [
  { role: 'hod', label: 'Head Of Department (HOD)', nameKey: 'hodName', emailKey: 'hodEmail' },
  {
    role: 'zonal_manager',
    label: 'Zonal Manager / Regional Collection Manager',
    nameKey: 'zonalManagerName',
    emailKey: 'zonalManagerEmail',
  },
  {
    role: 'ey_dd',
    label: 'EY Due Diligence Member (EY DD)',
    nameKey: 'eyDdName',
    emailKey: 'eyDdEmail',
  },
  {
    role: 'signatory_a',
    label: 'HFCL Authorized Signatory Group A',
    nameKey: 'signatoryAName',
    emailKey: 'signatoryAEmail',
  },
  {
    role: 'signatory_b',
    label: 'HFCL Authorized Signatory Group B',
    nameKey: 'signatoryBName',
    emailKey: 'signatoryBEmail',
  },
  { role: 'sap_team', label: 'SAP Team', nameKey: 'sapTeamName', emailKey: 'sapTeamEmail' },
  { role: 'sfdc_team', label: 'SFDC Team', nameKey: null, emailKey: 'sfdcTeamEmail' },
];
