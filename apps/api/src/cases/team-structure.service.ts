import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth-user';

/** Every team-structure field, in display order. Shared by the master lookup and the case snapshot. */
export const TEAM_FIELDS = [
  'proposerName',
  'proposerEmail',
  'proposerDepartment',
  'hodName',
  'hodEmail',
  'zonalManagerName',
  'zonalManagerEmail',
  'eyDdName',
  'eyDdEmail',
  'signatoryAName',
  'signatoryAEmail',
  'signatoryBName',
  'signatoryBEmail',
  'sapTeamName',
  'sapTeamEmail',
  'sfdcTeamEmail',
] as const;

export type TeamField = (typeof TEAM_FIELDS)[number];
export type TeamStructureFields = Record<TeamField, string | null>;

/** Fields a proposer may send as changes for a case. Their own name and email come from the login. */
export const TEAM_OVERRIDE_KEYS = [
  'proposerDepartment',
  'hodName',
  'hodEmail',
  'zonalManagerName',
  'zonalManagerEmail',
  'eyDdName',
  'eyDdEmail',
  'signatoryAName',
  'signatoryAEmail',
  'signatoryBName',
  'signatoryBEmail',
  'sapTeamName',
  'sapTeamEmail',
  'sfdcTeamEmail',
] as const;
export type TeamOverrides = Partial<Record<(typeof TEAM_OVERRIDE_KEYS)[number], string>>;

/** The team stored on a case: the resolved values plus which of them differ from the master. */
export type TeamSnapshot = TeamStructureFields & { overriddenFields: TeamField[] };

/** A role whose person is picked from the directory by email (the name follows from the email). */
interface TeamRole {
  role: string;
  label: string;
  name: TeamField | null;
  email: TeamField;
}
export const TEAM_ROLES: readonly TeamRole[] = [
  { role: 'hod', label: 'Head Of Department (HOD)', name: 'hodName', email: 'hodEmail' },
  {
    role: 'zonal_manager',
    label: 'Zonal Manager / Regional Collection Manager',
    name: 'zonalManagerName',
    email: 'zonalManagerEmail',
  },
  { role: 'ey_dd', label: 'EY Due Diligence Member', name: 'eyDdName', email: 'eyDdEmail' },
  {
    role: 'signatory_a',
    label: 'HFCL Authorized Signatory Group A',
    name: 'signatoryAName',
    email: 'signatoryAEmail',
  },
  {
    role: 'signatory_b',
    label: 'HFCL Authorized Signatory Group B',
    name: 'signatoryBName',
    email: 'signatoryBEmail',
  },
  { role: 'sap_team', label: 'SAP Team', name: 'sapTeamName', email: 'sapTeamEmail' },
  { role: 'sfdc_team', label: 'SFDC Team', name: null, email: 'sfdcTeamEmail' },
];

export interface DirectoryPerson {
  name: string;
  email: string;
}

/**
 * Looks up a proposer's team structure (HOD, zonal manager, EY DD, HFCL signatories, SAP and SFDC
 * teams) in team_structure_master, keyed by the proposer's login email. The proposer's own name and
 * email always come from the login. People for each role are chosen from team_directory by email,
 * and the name always comes from the directory, never from the browser.
 */
@Injectable()
export class TeamStructureService {
  constructor(private readonly prisma: PrismaService) {}

  /** The proposer's team structure, or null when nothing is configured for their login. */
  async forProposer(actor: AuthUser): Promise<TeamStructureFields | null> {
    const m = await this.prisma.teamStructureMaster.findFirst({
      where: { proposerEmail: { equals: actor.email.trim(), mode: 'insensitive' } },
    });
    if (!m) return null;
    const out = {} as TeamStructureFields;
    for (const k of TEAM_FIELDS) out[k] = (m[k] as string | null) ?? null;
    out.proposerName = actor.name;
    out.proposerEmail = actor.email;
    return out;
  }

  private async baseTeam(
    actor: AuthUser,
  ): Promise<{ configured: boolean; team: TeamStructureFields }> {
    const team = await this.forProposer(actor);
    if (team) return { configured: true, team };
    const empty = {} as TeamStructureFields;
    for (const k of TEAM_FIELDS) empty[k] = null;
    empty.proposerName = actor.name;
    empty.proposerEmail = actor.email;
    return { configured: false, team: empty };
  }

  /** Everyone who can be chosen for each role, keyed by role. */
  async directory(): Promise<Record<string, DirectoryPerson[]>> {
    const rows = await this.prisma.teamDirectory.findMany({
      orderBy: [{ roleKey: 'asc' }, { name: 'asc' }],
    });
    const out: Record<string, DirectoryPerson[]> = {};
    for (const r of rows) (out[r.roleKey] ??= []).push({ name: r.name, email: r.email });
    return out;
  }

  /**
   * The team to store on a case: the master's values with the proposer's choices applied. A person
   * is chosen by email; the email must be in the directory for that role and the name is taken from
   * there. A choice equal to the master is ignored, and the genuinely changed fields are recorded.
   */
  async resolve(actor: AuthUser, overrides?: TeamOverrides): Promise<TeamSnapshot> {
    const { team: base } = await this.baseTeam(actor);
    const out = { ...base } as TeamStructureFields;
    const overridden: TeamField[] = [];

    const dept = overrides?.proposerDepartment;
    if (dept !== undefined) {
      const next = dept.trim() || null;
      if (next !== (base.proposerDepartment ?? null)) {
        out.proposerDepartment = next;
        overridden.push('proposerDepartment');
      }
    }

    const wanted = TEAM_ROLES.filter(
      (r) => overrides?.[r.email as keyof TeamOverrides] !== undefined,
    );
    if (wanted.length > 0) {
      const dir = await this.prisma.teamDirectory.findMany({
        where: { roleKey: { in: wanted.map((r) => r.role) } },
      });
      for (const r of wanted) {
        const email = (overrides?.[r.email as keyof TeamOverrides] ?? '').trim();
        if (email.toLowerCase() === (base[r.email] ?? '').toLowerCase()) continue;
        if (!email) {
          out[r.email] = null;
          if (r.name) out[r.name] = null;
        } else {
          const person = dir.find(
            (d) => d.roleKey === r.role && d.email.toLowerCase() === email.toLowerCase(),
          );
          if (!person) {
            throw new BadRequestException(
              `"${email}" is not one of the people available for ${r.label}.`,
            );
          }
          out[r.email] = person.email;
          if (r.name) out[r.name] = person.name;
        }
        overridden.push(r.email);
        if (r.name) overridden.push(r.name);
      }
    }
    return { ...out, overriddenFields: overridden };
  }

  /** What the form shows: the configured team, the people to choose from, and whether a team exists. */
  async preview(actor: AuthUser): Promise<{
    configured: boolean;
    team: TeamStructureFields;
    directory: Record<string, DirectoryPerson[]>;
  }> {
    const [base, directory] = await Promise.all([this.baseTeam(actor), this.directory()]);
    return { ...base, directory };
  }
}
