import antfu from '@antfu/eslint-config'
import oxlint from 'eslint-plugin-oxlint'

export default antfu({
  ...oxlint.buildFromOxlintConfigFile('./oxlintrc.jsonc'),
})
