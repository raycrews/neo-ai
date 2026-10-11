const { checkRepository } = require('./privacy-check.cjs');

module.exports = async context => {
  checkRepository(context.packager.projectDir);
};
