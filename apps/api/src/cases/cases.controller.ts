import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  PERMISSIONS,
  WORKFLOW_ACTIONS,
  REVIEW_STAGES,
  isApprovalLevel,
  type ApprovalLevel,
  type ReviewStage,
  validatePan,
  validateGstin,
  validateIfsc,
  CONSTITUTIONS,
  MANAGEMENT,
  PERSON_FIELD_LABELS,
  managementRole,
} from '@vop/shared';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { RequirePermissions } from '../authz/permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BULK_ACTIONS, CasesService, type CaseCreateInput, type DraftInput } from './cases.service';
import { TEAM_OVERRIDE_KEYS } from './team-structure.service';

const phone = (what: string) =>
  z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{6,15}$/, `Enter a valid ${what}.`)
    .optional();

// Management structure — one row per proprietor / partner / director / Karta. All personal data;
// stored encrypted. Which fields are required depends on the constitution (checked on the case).
export const partnerSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be a valid date.')
      .refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d) < new Date(), {
        message: 'Date of birth must be a past date.',
      }),
    maritalStatus: z.enum(['Single', 'Married', 'Divorced', 'Widowed']),
    gender: z.enum(['Male', 'Female', 'Other']),
    fatherName: z.string().trim().min(1).max(200),
    spouseName: z.string().trim().max(200).optional(),
    pan: z.string().refine((v) => validatePan(v).valid, 'Enter a valid PAN.'),
    address: z.string().trim().min(1).max(500),
    mobile: z
      .string()
      .regex(/^[6-9]\d{9}$/, 'Mobile must be a 10-digit Indian number.')
      .optional(),
    residencePhone: phone('residence phone number'),
    contact: phone('contact number'),
    officeAddress: z.string().trim().max(500).optional(),
    pincode: z.string().regex(/^\d{6}$/, 'Pin code must be 6 digits.'),
  })
  .strict()
  .refine((p) => p.maritalStatus !== 'Married' || !!p.spouseName, {
    message: 'Spouse name is required when married.',
    path: ['spouseName'],
  });

// A draft may be saved half-finished: only the category is required and values are stored as typed
// (format checks run when the case is submitted).
const optStr = (max = 500) => z.string().max(max).optional();
// Changes the proposer made to their team structure for this case (only known fields; emails checked).
const teamOverridesSchema = z
  .record(z.enum(TEAM_OVERRIDE_KEYS), z.string().trim().max(200))
  .superRefine((o, ctx) => {
    for (const [k, v] of Object.entries(o)) {
      if (k.endsWith('Email') && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [k],
          message: 'Enter a valid email address.',
        });
      }
    }
  });
const draftPartnerSchema = z
  .object({
    name: optStr(200),
    dob: optStr(10),
    maritalStatus: optStr(20),
    gender: optStr(20),
    fatherName: optStr(200),
    spouseName: optStr(200),
    pan: optStr(10),
    address: optStr(500),
    mobile: optStr(10),
    residencePhone: optStr(20),
    contact: optStr(20),
    officeAddress: optStr(500),
    pincode: optStr(6),
  })
  .strict();
const draftReferenceSchema = z
  .object({
    contactName: optStr(200),
    businessName: optStr(200),
    registeredAddress: optStr(500),
    contactNumber: optStr(20),
    email: optStr(200),
  })
  .strict();
const rcLimitAmount = z.number().min(0).max(9_999_999_999_999);
const draftRcLimitSchema = z
  .object({
    financerName: optStr(200),
    rcLimit: rcLimitAmount.nullable().optional(),
    numberOfVehicles: z.number().int().min(0).max(100_000).nullable().optional(),
    remarks: optStr(500),
  })
  .strict();
const draftSchema = z
  .object({
    categoryKey: z.string().min(1),
    subCategoryKey: optStr(100),
    legalName: optStr(200),
    tradeName: optStr(200),
    businessAddress: optStr(500),
    addressCountry: optStr(100),
    addressState: optStr(100),
    addressCity: optStr(100),
    addressPostalCode: optStr(12),
    constitution: optStr(40),
    contactName: optStr(200),
    contactEmail: optStr(200),
    contactPhone: optStr(30),
    signatoryName: optStr(200),
    signatoryEmail: optStr(200),
    signatoryMobile: optStr(15),
    signatoryPan: optStr(12),
    pan: optStr(12),
    gstin: optStr(20),
    ifsc: optStr(15),
    bankAccount: optStr(30),
    bankName: optStr(200),
    branch: optStr(200),
    businessUnit: optStr(200),
    costCentre: optStr(200),
    spend: z.number().int().min(0).optional(),
    contractMonths: z.number().int().min(0).optional(),
    natureOfService: optStr(500),
    justification: optStr(4000),
    coiDeclared: z.boolean().optional(),
    coiDetails: optStr(1000),
    dataAccess: optStr(200),
    systemAccess: optStr(200),
    subcontract: optStr(200),
    delivery: optStr(200),
    screening: optStr(200),
    conflict: optStr(200),
    litigation: optStr(200),
    insurance: optStr(200),
    certifications: optStr(200),
    isecItHardware: z.boolean().optional(),
    isecItSoftware: z.boolean().optional(),
    isecAccessSystem: z.boolean().optional(),
    isecAccessNetwork: z.boolean().optional(),
    isecAccessApps: z.boolean().optional(),
    isecAccessPii: z.boolean().optional(),
    partners: z.array(draftPartnerSchema).max(50).optional(),
    references: z.array(draftReferenceSchema).max(10).optional(),
    rcLimits: z.array(draftRcLimitSchema).max(20).optional(),
    teamOverrides: teamOverridesSchema.optional(),
    proposerId: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

// Trade references: the proposer must supply at least two to submit a case.
export const referenceSchema = z
  .object({
    contactName: z.string().trim().min(1, 'Enter the contact name.').max(200),
    businessName: z.string().trim().min(1, 'Enter the legal name of the business.').max(200),
    registeredAddress: z.string().trim().min(1, 'Enter the registered address.').max(500),
    contactNumber: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s()]{7,15}$/, 'Enter a valid contact number.'),
    email: z.string().trim().email('Enter a valid email address.').max(200),
  })
  .strict();

// RC (revolving credit) limits held with financers. Optional; each row needs a financer and amount.
export const rcLimitSchema = z
  .object({
    financerName: z.string().trim().min(1, 'Enter the name of the financer.').max(200),
    rcLimit: rcLimitAmount,
    numberOfVehicles: z
      .number({ invalid_type_error: 'Enter the number of vehicles.' })
      .int('Number of vehicles must be a whole number.')
      .min(1, 'Enter the number of vehicles.')
      .max(100_000),
    remarks: z.string().trim().max(500).optional(),
  })
  .strict();

export const createSchema = z
  .object({
    categoryKey: z.string().min(1),
    partners: z.array(partnerSchema).max(50).optional(),
    references: z.array(referenceSchema).min(2, 'At least two references are required.').max(10),
    rcLimits: z.array(rcLimitSchema).max(20).optional(),
    teamOverrides: teamOverridesSchema.optional(),
    proposerId: z.string().trim().min(1).max(40).optional(),
    subCategoryKey: z.string().optional(),
    legalName: z.string().min(1),
    tradeName: z.string().optional(),
    businessAddress: z.string().max(500).optional(),
    addressCountry: z.string().trim().max(100).optional(),
    addressState: z.string().trim().max(100).optional(),
    addressCity: z.string().trim().max(100).optional(),
    addressPostalCode: z.string().trim().max(12).optional(),
    constitution: z.enum(CONSTITUTIONS, {
      errorMap: () => ({ message: 'Select the type of constitution.' }),
    }),
    contactName: z.string().optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
    signatoryName: z.string().max(200).optional(),
    signatoryEmail: z.string().email('Enter a valid email address.').optional(),
    signatoryMobile: z
      .string()
      .regex(/^[6-9]\d{9}$/, 'Mobile must be a 10-digit Indian number.')
      .optional(),
    signatoryPan: z.string().optional(),
    pan: z.string().optional(),
    gstin: z.string().optional(),
    ifsc: z.string().optional(),
    bankAccount: z.string().optional(),
    bankName: z.string().optional(),
    branch: z.string().optional(),
    businessUnit: z.string().optional(),
    costCentre: z.string().optional(),
    spend: z.number().int().min(0).optional(),
    contractMonths: z.number().int().min(0).optional(),
    natureOfService: z.string().optional(),
    justification: z.string().max(4000).optional(),
    coiDeclared: z.boolean().optional(),
    coiDetails: z.string().optional(),
    dataAccess: z.string().optional(),
    systemAccess: z.string().optional(),
    subcontract: z.string().optional(),
    delivery: z.string().optional(),
    screening: z.string().optional(),
    conflict: z.string().optional(),
    litigation: z.string().optional(),
    insurance: z.string().optional(),
    certifications: z.string().optional(),
    // information-security questionnaire — all required; any true routes to InfoSec review
    isecItHardware: z.boolean(),
    isecItSoftware: z.boolean(),
    isecAccessSystem: z.boolean(),
    isecAccessNetwork: z.boolean(),
    isecAccessApps: z.boolean(),
    isecAccessPii: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Server-side format validation for statutory identifiers (defence in depth; the UI also checks).
    if (v.pan && !validatePan(v.pan).valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pan'],
        message: 'PAN must be five letters, four digits, then one letter (e.g. ABCDE1234F).',
      });
    }
    if (v.gstin) {
      const g = validateGstin(v.gstin, v.pan);
      if (!g.valid) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gstin'], message: g.errors[0] });
      }
    }
    if (v.ifsc && !validateIfsc(v.ifsc).valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ifsc'],
        message: 'IFSC must be four letters, a zero, then six characters (e.g. HDFC0001234).',
      });
    }
    // No GST registration: the address is not available from the GST registry, so it must be given.
    if (!v.gstin) {
      const need = [
        ['businessAddress', 'Enter the full address.'],
        ['addressCountry', 'Enter the country.'],
        ['addressState', 'Enter the state.'],
        ['addressCity', 'Enter the city.'],
        ['addressPostalCode', 'Enter the postal code.'],
      ] as const;
      for (const [k, message] of need) {
        if (!v[k]?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message });
      }
    }
    if (v.addressPostalCode) {
      const india = !v.addressCountry || /^india$/i.test(v.addressCountry.trim());
      const ok = india
        ? /^[1-9]\d{5}$/.test(v.addressPostalCode)
        : /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}$/.test(v.addressPostalCode);
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['addressPostalCode'],
          message: india ? 'PIN code must be 6 digits.' : 'Enter a valid postal code.',
        });
      }
    }
    // Management structure: the people asked about follow the type of constitution.
    const role = managementRole(v.constitution);
    if (role) {
      const def = MANAGEMENT[role];
      const people = v.partners ?? [];
      if (people.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['partners'],
          message: `Enter the details of the ${def.noun.toLowerCase()}.`,
        });
      } else if (def.single && people.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['partners'],
          message: `Enter the details of one ${def.noun.toLowerCase()} only.`,
        });
      }
      people.forEach((p, i) => {
        for (const k of def.fields) {
          if (k === 'spouseName' || p[k]?.trim()) continue;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['partners', i, k],
            message: `Enter the ${PERSON_FIELD_LABELS[k].toLowerCase()}.`,
          });
        }
      });
    }
    if (v.signatoryPan && !validatePan(v.signatoryPan).valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signatoryPan'],
        message: 'PAN must be five letters, four digits, then one letter (e.g. ABCDE1234F).',
      });
    }
  });

// One action applied to several cases from the case list. Each case is checked individually.
const bulkSchema = z
  .object({
    action: z.enum(BULK_ACTIONS),
    ids: z.array(z.string().min(1).max(40)).min(1).max(100),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

const actionSchema = z
  .object({ action: z.enum(WORKFLOW_ACTIONS), note: z.string().max(2000).optional() })
  .strict();
const infosecDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'sendback']),
    note: z.string().max(2000).optional(),
  })
  .strict();
// FCU due-diligence findings, captured on the FCU review screen.
const fcuFindingsSchema = z
  .object({
    residentialAddressCheck: z.boolean(),
    officeAddressCheck: z.boolean(),
    overallFinding: z.enum(['positive', 'negative']),
    comment: z.string().max(4000).optional(),
  })
  .strict();
const stageDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'sendback']),
    note: z.string().max(2000).optional(),
    agreement: z.string().max(20000).optional(),
    fcu: fcuFindingsSchema.optional(),
  })
  .strict();
const sapDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().max(2000).optional(),
  })
  .strict();
const commentSchema = z.object({ body: z.string().min(1).max(4000) }).strict();
const checklistSchema = z.object({ itemId: z.string().min(1), done: z.boolean() }).strict();

@ApiTags('cases')
@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.VendorCreate)
  @ApiOperation({
    summary:
      'Raise a vendor onboarding case directly. Refused: a case is submitted from its draft once Digi KYC is completed.',
  })
  create(
    @CurrentUser() _actor: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) _body: CaseCreateInput,
  ) {
    // Digi KYC runs on the saved draft and must be completed before the case is submitted
    // (PATCH /cases/:id), so a case can no longer be raised without one.
    throw new BadRequestException('Complete Digi KYC before submitting the case.');
  }

  @Post('bulk')
  @ApiOperation({
    summary:
      'Hold, resume, cancel, reopen or delete several cases at once (each checked on its own)',
  })
  bulk(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(bulkSchema)) body: z.infer<typeof bulkSchema>,
  ) {
    return this.cases.bulk(actor, body.action, body.ids, body.note);
  }

  @Post('drafts')
  @RequirePermissions(PERMISSIONS.VendorCreate)
  @ApiOperation({ summary: 'Start a draft case (autosave; private to the proposer)' })
  createDraft(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(draftSchema)) body: DraftInput,
  ) {
    return this.cases.createDraft(actor, body);
  }

  @Put(':id/draft')
  @RequirePermissions(PERMISSIONS.VendorCreate)
  @ApiOperation({ summary: 'Autosave an own draft case' })
  saveDraft(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(draftSchema)) body: DraftInput,
  ) {
    return this.cases.updateDraftContent(actor, id, body);
  }

  @Delete(':id/draft')
  @RequirePermissions(PERMISSIONS.VendorCreate)
  @ApiOperation({ summary: 'Discard an own draft case' })
  discardDraft(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.cases.deleteDraft(actor, id);
  }

  @Get()
  @ApiOperation({ summary: 'List cases (own for proposers, all for reviewers)' })
  list(
    @CurrentUser() actor: AuthUser,
    @Query('stage') stage?: string,
    @Query('tier') tier?: string,
    @Query('q') q?: string,
    @Query('queue') queue?: string,
    @Query('ref') ref?: string,
    @Query('status') status?: string,
  ) {
    return this.cases.list(actor, { stage, tier, q, queue, ref, status });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a case (masked unless vendor:view_sensitive)' })
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.cases.get(actor, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VendorEdit)
  @ApiOperation({ summary: 'Edit and resubmit an own draft case (proposer)' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createSchema)) body: CaseCreateInput,
  ) {
    return this.cases.updateDraft(actor, id, body);
  }

  @Post(':id/action')
  @ApiOperation({ summary: 'Workflow action: submit/advance/return/reject/hold/resume/reopen' })
  action(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(actionSchema)) body: z.infer<typeof actionSchema>,
  ) {
    return this.cases.action(actor, id, body.action, body.note);
  }

  @Post(':id/infosec-decision')
  @RequirePermissions(PERMISSIONS.WorkflowStageApprove)
  @ApiOperation({ summary: 'InfoSec review decision: approve / reject / send back (with remark)' })
  infosecDecision(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(infosecDecisionSchema)) body: z.infer<typeof infosecDecisionSchema>,
  ) {
    return this.cases.infosecDecision(actor, id, body.decision, body.note);
  }

  @Post(':id/stage/:stage/decision')
  @RequirePermissions(PERMISSIONS.WorkflowStageApprove)
  @ApiOperation({
    summary:
      'Stage decision (InfoSec/FCU/Operation/Legal, or approval level l1/l2/l3): approve/reject/sendback',
  })
  stageDecision(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Param('stage') stage: string,
    @Body(new ZodValidationPipe(stageDecisionSchema)) body: z.infer<typeof stageDecisionSchema>,
  ) {
    if (!REVIEW_STAGES.includes(stage as ReviewStage) && !isApprovalLevel(stage)) {
      throw new BadRequestException('Unknown review stage.');
    }
    return this.cases.stageDecision(
      actor,
      id,
      stage as ReviewStage | ApprovalLevel,
      body.decision,
      body.note,
      {
        agreement: body.agreement,
        fcu: body.fcu,
      },
    );
  }

  @Post(':id/sap-decision')
  @RequirePermissions(PERMISSIONS.WorkflowStageApprove)
  @ApiOperation({
    summary: 'SAP confirmation (final stage): approve activates the vendor / reject',
  })
  sapDecision(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sapDecisionSchema)) body: z.infer<typeof sapDecisionSchema>,
  ) {
    return this.cases.sapDecision(actor, id, body.decision, body.note);
  }

  @Post(':id/comment')
  @ApiOperation({ summary: 'Add a comment to a case' })
  comment(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(commentSchema)) body: z.infer<typeof commentSchema>,
  ) {
    return this.cases.comment(actor, id, body.body);
  }

  @Post(':id/export-log')
  @HttpCode(204)
  @ApiOperation({ summary: 'Audit that the vendor details were downloaded as a PDF' })
  async exportLog(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.cases.logExport(actor, id);
  }

  @Post(':id/checklist')
  @ApiOperation({ summary: 'Sign off / clear a due-diligence checklist item' })
  checklist(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checklistSchema)) body: z.infer<typeof checklistSchema>,
  ) {
    return this.cases.tickChecklist(actor, id, body.itemId, body.done);
  }
}
