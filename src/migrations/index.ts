import * as migration_20261112_051637_initial from './20261112_051637_initial';
import * as migration_20261112_052822_add_pet_details from './20261112_052822_add_pet_details';
import * as migration_20261112_053400_add_pet_unlisted from './20261112_053400_add_pet_unlisted';
import * as migration_20261112_054707_add_pet_seo from './20261112_054707_add_pet_seo';
import * as migration_20261112_055021_add_pet_city_state from './20261112_055021_add_pet_city_state';
import * as migration_20261112_055352_add_user_roles from './20261112_055352_add_user_roles';
import * as migration_20261112_061303_add_site_theme from './20261112_061303_add_site_theme';

export const migrations = [
  {
    up: migration_20261112_051637_initial.up,
    down: migration_20261112_051637_initial.down,
    name: '20261112_051637_initial',
  },
  {
    up: migration_20261112_052822_add_pet_details.up,
    down: migration_20261112_052822_add_pet_details.down,
    name: '20261112_052822_add_pet_details',
  },
  {
    up: migration_20261112_053400_add_pet_unlisted.up,
    down: migration_20261112_053400_add_pet_unlisted.down,
    name: '20261112_053400_add_pet_unlisted',
  },
  {
    up: migration_20261112_054707_add_pet_seo.up,
    down: migration_20261112_054707_add_pet_seo.down,
    name: '20261112_054707_add_pet_seo',
  },
  {
    up: migration_20261112_055021_add_pet_city_state.up,
    down: migration_20261112_055021_add_pet_city_state.down,
    name: '20261112_055021_add_pet_city_state',
  },
  {
    up: migration_20261112_055352_add_user_roles.up,
    down: migration_20261112_055352_add_user_roles.down,
    name: '20261112_055352_add_user_roles',
  },
  {
    up: migration_20261112_061303_add_site_theme.up,
    down: migration_20261112_061303_add_site_theme.down,
    name: '20261112_061303_add_site_theme'
  },
];
