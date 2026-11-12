import * as migration_20261112_051637_initial from './20261112_051637_initial';
import * as migration_20261112_052822_add_pet_details from './20261112_052822_add_pet_details';

export const migrations = [
  {
    up: migration_20261112_051637_initial.up,
    down: migration_20261112_051637_initial.down,
    name: '20261112_051637_initial',
  },
  {
    up: migration_20261112_052822_add_pet_details.up,
    down: migration_20261112_052822_add_pet_details.down,
    name: '20261112_052822_add_pet_details'
  },
];
