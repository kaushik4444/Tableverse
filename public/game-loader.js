/* Loads a game's script and stylesheet the first time a table for that game opens (app.js renderGame asks for it).
 * Games used to load on every page; this keeps the home page and other tables from downloading games they do not show. */
(() => {
  'use strict';
  // game id -> file name under /games/ (linegames.js registers two games)
  const FILES = {
    wizard: 'wizard', twentynine: 'twentynine', poker: 'poker', themind: 'themind', ludo: 'ludo', gofish: 'gofish',
    colorclash: 'colorclash', hiddenminers: 'hiddenminers', propertyrivals: 'propertyrivals', penaltyrows: 'penaltyrows',
    stagerummy: 'stagerummy', tictactoe: 'linegames', fourinarow: 'linegames', chess: 'chess', carrom: 'carrom', snakesladders: 'snakesladders',
    bingo: 'bingo', sudoku: 'sudoku', dotsboxes: 'dotsboxes', seabattle: 'seabattle', memorymatch: 'memorymatch', fallingblocks: 'fallingblocks', resourceisles: 'resourceisles',
  };
  // files that have a stylesheet of their own (wizard and twentynine style themselves inside table.css)
  const HAS_CSS = new Set(['poker', 'themind', 'ludo', 'gofish', 'colorclash', 'hiddenminers', 'propertyrivals', 'penaltyrows', 'stagerummy', 'linegames', 'chess', 'carrom', 'snakesladders', 'bingo', 'fallingblocks', 'sudoku', 'dotsboxes', 'seabattle', 'memorymatch', 'resourceisles']);
  const loading = {};   // file -> promise while its script and stylesheet load (cleared on failure, so it can retry)
  const loaded = {};    // file -> true once both the script and the stylesheet have loaded

  const loadFile = (file) => {
    const parts = [];
    if (HAS_CSS.has(file)) {
      parts.push(new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `/games/${file}.css`;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`css ${file}`));
        // keep the cascade: game styles sit after table.css and before game-feed.css, as they did when they were in index.html
        const anchor = document.querySelector('link[href="/game-feed.css"]');
        if (anchor) anchor.before(link); else document.head.appendChild(link);
      }));
    }
    parts.push(new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `/games/${file}.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`js ${file}`));
      document.body.appendChild(script);
    }));
    return Promise.all(parts);
  };

  const TvGames = {
    /** Is this game id one that loads on demand? */
    knows: (gameId) => Object.prototype.hasOwnProperty.call(FILES, gameId),
    /** True only when the game's script AND stylesheet have both loaded (registering the game alone is not enough). */
    isLoaded: (gameId) => TvGames.knows(gameId) && !!loaded[FILES[gameId]],
    /** Resolves once the game's script and stylesheet are in the page. A failed load can be retried later. */
    ensure(gameId) {
      if (!TvGames.knows(gameId)) return Promise.resolve();
      const file = FILES[gameId];
      if (!loading[file]) {
        loading[file] = loadFile(file).then(
          () => { loaded[file] = true; },
          (err) => { delete loading[file]; throw err; },
        );
      }
      return loading[file];
    },
  };
  window.TvGames = TvGames;
})();
