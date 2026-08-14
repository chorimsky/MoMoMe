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

module.exports = config;
