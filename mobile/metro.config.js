// Metro config — MoMo›Me native app.
// This project lives inside the momome repo but is NOT a pnpm workspace member
// (kept isolated so the deployed web/server stacks are never destabilised by
// mobile dependency churn). It has its OWN complete node_modules, so the default
// resolver already resolves every dependency locally first. We only add the repo
// root's shared/ folder as a watch folder so the app can import the single source
// of truth for the API contract — shared/types.ts + shared/domain.ts (aliased as
// @shared/* in tsconfig; Metro reads tsconfig paths automatically).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(projectRoot, '..', 'shared')];

// shared/ is written as TypeScript ESM: its files import each other with a `.js` suffix,
// which is what Node (the server) and Vite (the web) require for the compiled output. Metro
// resolves TypeScript source directly and does not perform that mapping, so a RUNTIME
// import of "./domain.js" fails to resolve — the file on disk is domain.ts. It only ever
// worked before because the existing cross-imports were `import type`, which TypeScript
// erases before Metro sees them. The first value import (shared/receipt.ts) broke the iOS
// bundle. Try the literal name first so a real .js file still resolves, then fall back to
// the extensionless form and let sourceExts find the .ts. Relative paths only, so
// node_modules resolution is untouched.
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  if ((moduleName.startsWith('./') || moduleName.startsWith('../')) && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.slice(0, -3), platform);
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
