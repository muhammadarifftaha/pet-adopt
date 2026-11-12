import * as migration_20261112_051637_initial from './20261112_051637_initial';
import * as migration_20261112_052822_add_pet_details from './20261112_052822_add_pet_details';
import * as migration_20261112_053400_add_pet_unlisted from './20261112_053400_add_pet_unlisted';

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
    name: '20261112_053400_add_pet_unlisted'
  },
];
