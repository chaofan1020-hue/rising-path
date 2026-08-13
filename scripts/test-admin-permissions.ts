import assert from 'node:assert/strict';
import { createAdminSessionToken } from '@/lib/admin-auth';
import { ADMIN_PERMISSIONS, requireAdminPermission } from '@/lib/admin-permissions';

process.env.ADMIN_SESSION_SECRET = 'admin-permission-test-secret';

function requestForRole(role: 'content_admin' | 'support_admin') {
  process.env.ADMIN_SESSION_ROLE = role;
  return new Request('http://localhost/api/admin/test', {
    headers: { authorization: `Bearer ${createAdminSessionToken()}` },
  });
}

const contentRequest = requestForRole('content_admin');
assert.equal(requireAdminPermission(contentRequest, ADMIN_PERMISSIONS.dnaPublish), null);
assert.equal(requireAdminPermission(contentRequest, ADMIN_PERMISSIONS.jobsWrite), null);
assert.equal(requireAdminPermission(contentRequest, ADMIN_PERMISSIONS.auditRead)?.status, 403);
assert.equal(requireAdminPermission(contentRequest, ADMIN_PERMISSIONS.configWrite)?.status, 403);
assert.equal(requireAdminPermission(contentRequest, ADMIN_PERMISSIONS.usersRead)?.status, 403);
assert.equal(requireAdminPermission(contentRequest, ADMIN_PERMISSIONS.usageExport)?.status, 403);

const supportRequest = requestForRole('support_admin');
assert.equal(requireAdminPermission(supportRequest, ADMIN_PERMISSIONS.feedbackReview), null);
assert.equal(requireAdminPermission(supportRequest, ADMIN_PERMISSIONS.dnaPublish)?.status, 403);
assert.equal(requireAdminPermission(supportRequest, ADMIN_PERMISSIONS.usersRead), null);
assert.equal(requireAdminPermission(supportRequest, ADMIN_PERMISSIONS.jobsWrite)?.status, 403);
assert.equal(requireAdminPermission(supportRequest, ADMIN_PERMISSIONS.usageExport)?.status, 403);

const unauthenticated = new Request('http://localhost/api/admin/test');
assert.equal(requireAdminPermission(unauthenticated, ADMIN_PERMISSIONS.dashboardRead)?.status, 401);

console.log('Admin permission matrix checks passed');
