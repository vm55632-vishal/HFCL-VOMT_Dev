// Create the approval-level roles (L1, L2, L3) and a demo login for each, holding that role in
// every company (HFCL, HHFL). Idempotent; does NOT run the full destructive seed.
// Mirrors create-reviewers.cjs. Run from apps/api: node scripts/create-approvers.cjs
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { ROLES, RoleKey, newId } = require('@vop/shared');
const { createClient } = require('@supabase/supabase-js');

// Load apps/api/.env for anything not already set (never printed).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([^#=][^=]*)=(.*)$/.exec(line);
    if (m && process.env[m[1].trim()] === undefined) process.env[m[1].trim()] = m[2];
  }
}

const APPROVERS = [
  { key: RoleKey.L1, email: 'l1@vop.local', name: 'L1 Approver' },
  { key: RoleKey.L2, email: 'l2@vop.local', name: 'L2 Approver' },
  { key: RoleKey.L3, email: 'l3@vop.local', name: 'L3 Approver' },
];

(async () => {
  const prisma = new PrismaClient();
  const url = process.env.VOP_SUPABASE_URL;
  const serviceRole = process.env.VOP_SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.VOP_SEED_SUPABASE_PASSWORD;
  const admin =
    url && serviceRole ? createClient(url, serviceRole, { auth: { persistSession: false } }) : null;
  const entities = await prisma.entity.findMany({ select: { id: true, code: true } });

  for (const r of APPROVERS) {
    const def = ROLES[r.key];
    // 1) Role
    await prisma.role.upsert({
      where: { key: def.key },
      create: {
        id: newId(),
        key: def.key,
        label: def.label,
        description: def.description,
        builtIn: true,
        permissions: [...def.permissions],
      },
      update: { label: def.label, description: def.description, permissions: [...def.permissions] },
    });

    // 2) App user; company roles live in user_entity_role (ADR-0008), one row per company.
    const user = await prisma.user.upsert({
      where: { email: r.email },
      create: { id: newId(), email: r.email, name: r.name, status: 'ACTIVE', authMethod: 'OIDC' },
      update: { name: r.name, status: 'ACTIVE' },
    });
    for (const e of entities) {
      await prisma.userEntityRole.upsert({
        where: { userId_entityId_roleKey: { userId: user.id, entityId: e.id, roleKey: def.key } },
        create: { id: newId(), userId: user.id, entityId: e.id, roleKey: def.key },
        update: {},
      });
    }

    // 3) Supabase auth user
    if (admin && password) {
      let existingId = null;
      for (let page = 1; ; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const found = data.users.find((u) => u.email && u.email.toLowerCase() === r.email);
        if (found) {
          existingId = found.id;
          break;
        }
        if (data.users.length < 1000) break;
      }
      if (existingId) {
        await admin.auth.admin.updateUserById(existingId, {
          password,
          email_confirm: true,
          user_metadata: { name: r.name },
        });
      } else {
        const { error } = await admin.auth.admin.createUser({
          email: r.email,
          password,
          email_confirm: true,
          user_metadata: { name: r.name },
        });
        if (error) throw error;
      }
      console.log(
        `OK  ${def.key.padEnd(4)} -> login ${r.email} in ${entities.map((e) => e.code).join(', ')}`,
      );
    } else {
      console.log(
        `OK  ${def.key.padEnd(4)} (role + local user; set the Supabase password manually)`,
      );
    }
  }

  await prisma.$disconnect();
  console.log('Done.');
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
