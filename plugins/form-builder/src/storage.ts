// The form builder's storage: its tables (../schema), the migrations generated from them
// (../migrations.ts, by `pnpm plugin:generate plugins/form-builder <name>`), and a handle to open
// them. `open()` goes through the app (no import of the app here) and throws, with a message for the
// owner, until `pnpm migrate` has set the tables up.
import { definePluginStorage } from '@pet-adopt/plugin-sdk'

import { migrations } from '../migrations'
import * as pg from '../schema/pg'
import * as sqlite from '../schema/sqlite'

export { FORM_BUILDER } from './names'

export const formBuilderStorage = definePluginStorage({ tables: { sqlite, pg }, migrations })

export const openFormsDatabase = () => formBuilderStorage.open()
