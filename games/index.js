'use strict';
// Game registry. To add a game: create games/<id>/index.js (see games/README.md) and list it here.
const registry = {
  wizard: require('./wizard'),
  twentynine: require('./twentynine'),
  poker: require('./poker'),
  themind: require('./themind'),
  ludo: require('./ludo'),
  gofish: require('./gofish'),
  snakesladders: require('./snakesladders'),
  propertyrivals: require('./propertyrivals'),
  // Tic-Tac-Toe and Four in a Row (four or five) share one engine
  ...Object.fromEntries(require('./linegames').map((game) => [game.id, game])),
};

module.exports = {
  get: (id) => (typeof id === 'string' && Object.hasOwn(registry, id) ? registry[id] : null),
  list: () =>
    Object.values(registry).map(({ id, name, tagline, icon, accent, seats, options, rules }) => ({
      id,
      name,
      tagline,
      icon,
      accent,
      seats,
      options,
      rules,
    })),
};
