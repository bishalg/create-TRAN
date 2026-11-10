import { formatClient } from '@tran/core';

/**
 * What the web sends as `X-Tran-Client` on every request (REQ-VER-004): its platform and the
 * product version `pnpm release` owns, baked in at build time.
 */
export const WEB_CLIENT = formatClient('web', __TRAN_VERSION__);
