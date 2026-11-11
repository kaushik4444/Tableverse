'use strict';
/**
 * Publication switch for the Impressum (public/impressum.html).
 *
 * Off unless LEGAL_IMPRESSUM_PUBLISHED is exactly "true" (fail closed). While off, the page answers 404, the
 * server tells the client it is not published, and the client shows no link to it. Turning it on is a deliberate
 * owner action after the legal review; it is not part of any deploy.
 */
function impressumPublished(env) { return env.LEGAL_IMPRESSUM_PUBLISHED === 'true'; }

module.exports = { impressumPublished };
