import * as migration_20261112_051637_initial from './20261112_051637_initial';

export const migrations = [
  {
    up: migration_20261112_051637_initial.up,
    down: migration_20261112_051637_initial.down,
    name: '20261112_051637_initial'
  },
];
