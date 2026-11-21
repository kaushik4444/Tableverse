/*
 * What's new: the release history, newest first. Each release has the items shown to players.
 *  - The home What's new shows the first three items of the newest release (its highlights).
 *  - What's new > All versions (also in the account menu) lists every release.
 * Keep the wording player-facing. An item with voice: true is hidden when voice chat is off.
 * Add a new release at the top when a change ships; keep the version string equal to the one in public/app.js.
 */
(function () {
  window.TV_RELEASES = [
    {
      version: '2026-11-21-color-clash-hidden-miners',
      date: '2026-11-21',
      title: 'Two new games',
      items: [
        { ico: '🎨', title: 'Color Clash', text: 'Match the colour or the number and be first to empty your hand. Stop, Flip, Take 2 and Wild cards shake things up. Two to eight players, with bots, and a score that adds up over the rounds.' },
        { ico: '⛏️', title: 'Hidden Miners', text: 'Dig a tunnel toward the gold, but someone at the table is secretly a Saboteur. Break and repair tools, scout the chambers and collapse tunnels. Three to eight players.' },
        { ico: '📱', title: 'More room on phones', text: 'The main buttons are a little smaller on a phone, so the table and your cards get more space.' },
      ],
    },
    {
      version: '2026-11-20-twelve-games',
      date: '2026-11-20',
      title: 'Twelve games for everyone',
      items: [
        { ico: '🎲', title: 'Twelve games, open by default', text: 'Go Fish, Ludo, Take 5, Poker, Property Rivals, Snakes and Ladders, Stage 10, Mind, 29, Wizard, Tic-Tac-Toe and Four in a Row are open to every player unless the owner has limited one. A game that is closed to you is greyed out on the home page as unavailable.' },
        { ico: '🖼️', title: 'Every game has its own logo', text: 'Each game has a mark of its own. It looks the same on the home page, in open tables, in your history and in the stats.' },
        { ico: '🏠', title: 'Open tables above the games', text: 'Open tables are listed at the top of the home page, so you can join one straight away. On a phone they sit in two rows that scroll sideways. On a wide screen they sit beside the games.' },
        { ico: '🃏', title: 'Take 5 has new card art', text: 'Each card shows its number in the corners, and its penalty points as stars, so you can read the risk at a glance. Up to eight players.' },
        { ico: '🪜', title: 'Stage 10 shows every stage', text: 'Each player’s current stage is shown at the table, like the bids in Wizard. The cards are easier to tell apart, and a Phases sheet explains every stage.' },
        { ico: '♠️', title: 'Poker hand rankings', text: 'Open the hand rankings sheet at the table to see which hands beat which.' },
      ],
    },
    {
      version: '2026-11-20-game-names',
      date: '2026-11-20',
      title: 'New game names',
      items: [
        { ico: '🏷️', title: 'Three games have new names', text: 'Penalty Rows is now Take 5, Stage Rummy is now Stage 10, and The Mind is now Mind. The games play exactly the same, and your matches and stats are all still there.' },
      ],
    },
    {
      version: '2026-11-18-guest-play',
      date: '2026-11-18',
      title: 'Play as a guest',
      items: [
        { ico: '👋', title: 'Play without an account', text: 'Try a game as a guest from the home page. A guest visit lasts a few days in this browser, and you can turn it into a full account at any time without losing your games.' },
        { ico: '🔒', title: 'Some games need an account', text: 'The owner can keep a game for registered players only. Where that applies to you, the game shows a note and you can create an account from it.' },
        { ico: '🔔', title: 'Quiet reminders', text: 'Guests see a short reminder that an account keeps their progress. It never interrupts a game, and you can dismiss it.' },
      ],
    },
    {
      version: '2026-11-17-game-over-table',
      date: '2026-11-17',
      title: 'One table at the end of a game',
      items: [
        { ico: '🏁', title: 'Game XP at the end of a game, in one table', text: 'The game-over screen no longer shows progress cards. It lists everyone at the table with the XP they earned in that game.' },
        { ico: '📈', title: 'Your lifetime XP in each game', text: 'The same table shows each player’s lifetime XP in that game across all their finished matches. Guests show a dash, since their games are not kept.' },
        { ico: '🎉', title: 'Level-up dialog', text: 'When you reach a new level, the next time you open the menu shows your new level and how much XP is left to the next one.' },
      ],
    },
    {
      version: '2026-11-15-level-and-follow',
      date: '2026-11-15',
      title: 'Your level, and where to follow us',
      items: [
        { ico: '⭐', title: 'See how far you are to the next level', text: 'Your profile shows your level, the minutes played and how many more you need to reach the next one.' },
        { ico: '🎉', title: 'A level-up notice, once', text: 'When you reach a new level you see a short notice with the new level. Tap Got it and it will not show again for that level on this device.' },
        { ico: '📸', title: 'Follow @playtableverse on Instagram', text: 'The home page footer has a link to our Instagram account, which opens in a new tab.' },
      ],
    },
    {
      version: '2026-11-leave-and-reactions',
      date: '2026-11-15',
      title: 'Leaving, reactions and history',
      items: [
        { ico: '↩️', title: 'Take your seat back within two minutes', text: 'If you leave a running game on purpose, you can take your seat back within two minutes of your first departure, and the penalty goes. After that a bot keeps the seat and you can watch. A dropped connection does not count as leaving. Your play time counts only while you are seated and connected.' },
        { ico: '🚪', title: 'Leaving a game with others counts as a loss', text: 'If other people are still playing, leaving asks first. If the game then finishes, it counts as a loss for you. If a second player also leaves, the game is abandoned: nobody is penalised, and the people who stayed get no result. Playing only against bots, leaving does not count.' },
        { ico: '😀', title: 'More reactions, and spectators can react', text: 'There are 21 reactions now. A spectator’s reaction shows their name with a 👁, so the table knows it came from someone watching.' },
        { ico: '🧾', title: 'Your history says why a game counted', text: 'Each game in your history shows whether you won, lost or drew, or whether you left and how that counted. Leaving against bots only is listed but not counted.' },
        { ico: '🎲', title: '29 rule options start on in a new table', text: 'The rule options for 29 and Shuffle seats for Wizard start switched on. The host can still change them in the lobby.' },
        { ico: '🃏', title: '29: one answer decides for the whole side', text: 'The whole answering side may double, redouble or accept, and one answer decides for both players.' },
        { ico: '🚫', title: 'Blocking is quicker and clearer', text: 'Block and unblock send one request at a time, and an error names the action that failed.' },
        { ico: '⋯', title: 'The ⋯ menu has the same labels in every game', text: 'The labels are in the same order in every game.' },
        { ico: '🟢', title: 'Ludo: the seat to play blinks', text: 'With six players, the outer yard of the seat to play blinks.' },
      ],
    },
    {
      version: '2026-11-14',
      date: '2026-11-14',
      title: 'Release of 14 November',
      items: [
        { ico: '🌍', title: 'New tables are public by default', text: 'They appear in the open tables. To make a table private, use Make private in its lobby (it is not offered once a game has started). Members and spectators already at the table keep access.' },
        { ico: '🃏', title: '29 on phones keeps the trump in view', text: 'The trump suit, or that it is still hidden or not yet chosen, stays on screen during play.' },
        { ico: '🔐', title: 'Keep me signed in on this device', text: 'An optional tick on the sign-in form keeps this browser signed in for 30 days after its last visit. It ends when you sign out, sign out everywhere, reset your password, or an owner suspends your account.' },
        { ico: '✉️', title: 'Owners can e-mail everyone from the admin console', text: 'To verified or unverified accounts, or accounts not seen for 30 days. Promotional mail has an unsubscribe link.' },
        { ico: '🏙️', title: 'Property Rivals: tap a city for its details', text: 'Its owner, buildings, rent now, the full rent table, and the mortgage, unmortgage and house costs.' },
        { ico: '👑', title: 'Property Rivals: the crown follows net worth', text: 'Each player shows cash and net worth separately. The crown marks the highest net worth, not the most cash.' },
        { ico: '⚙️', title: 'Game settings are always at the top right', text: 'Tap them for the full list, with each choice explained.' },
        { ico: '🔇', title: 'Blocking hides chat and voice', text: 'A block hides the blocked player’s table chat and voice and stops invitations between you. It no longer removes anyone from a table, so blocked players can share one.' },
        { ico: '🚩', title: 'Block and report players', text: 'From a table card or a profile page. A report has a reason and is stored once per reporter and player.' },
        { ico: '📖', title: 'Game settings explain the 29 options', text: 'Wizard and 29 have a host-controlled Shuffle seats option.' },
        { ico: '⋯', title: 'How to play, the game log and settings are in ⋯', text: 'They are in the ⋯ menu, so the bottom bar stays clear.' },
      ],
    },
    {
      version: '0.14.0',
      date: '',
      title: 'Voice chat',
      items: [
        { ico: '🎙️', title: 'Talk with your table', text: 'In-browser voice chat in the lobby and during games.', voice: true },
        { ico: '🔇', title: 'Mute, or listen without speaking', text: 'Mute your microphone, or join to listen only.', voice: true },
        { ico: '👥', title: 'See who is speaking', text: 'See who has joined voice and who is talking right now. Up to eight people per table.', voice: true },
        { ico: '🌐', title: 'No app to install', text: 'Use Tableverse over HTTPS and allow microphone access. Voice starts off and is only on when you choose to join. Audio is peer-to-peer, so connection quality can vary, and other participants may learn connection information such as IP addresses.', voice: true },
      ],
    },
    {
      version: 'v0.13',
      date: '',
      title: 'Shared feed and crowns',
      items: [
        { ico: '💬', title: 'Floating messages', text: 'New public log lines (a bid, a raise, a capture, a mistake, a rent payment) float over the table for a few seconds in Wizard, 29, Poker, Ludo, Mind and Property Rivals. Snakes and Ladders keeps its move banner; Go Fish has no log.' },
        { ico: '👑', title: 'A crown for who is ahead', text: 'Every scoring game shows it: Wizard, Poker (three or more players), 29 (team score), Go Fish, Snakes and Ladders, Ludo and Property Rivals.' },
        { ico: '📱', title: 'Checks for phones', text: 'Phone-fit and layout checks now cover Property Rivals, Tic-Tac-Toe and Four in a Row.' },
      ],
    },
    {
      version: 'v0.12',
      date: '',
      title: 'Tic-Tac-Toe and Four in a Row',
      items: [
        { ico: '⭕', title: 'Tic-Tac-Toe', text: 'A 3×3 board for two players. A full board with no line is a draw. Bots play perfectly.' },
        { ico: '🔴', title: 'Four in a Row, and Five in a Row', text: 'Drop discs into a 7×6 grid to connect four. Set Line length to five for Five in a Row on a 9×8 grid. Options include who starts.' },
        { ico: '🧭', title: 'Coming soon shows each game’s status', text: 'Hidden Miners is in development; the others are planned.' },
      ],
    },
    {
      version: 'v0.11',
      date: '',
      title: 'Property Rivals',
      items: [
        { ico: '🏠', title: 'Property Rivals is playable', text: 'For 2 to 6 players, with bots filling empty seats. A 40-square board with 22 cities, 4 ports and 2 utilities. Rent doubles on a full colour set, buildings go up to a hotel, properties mortgage, unsold properties go to auction, players trade, and there are Surprise and Community Fund cards.' },
        { ico: '🎲', title: 'Options', text: 'A short game (30 or 60 rounds, richest wins), starting cash, auctions on or off, and a Rest Stop jackpot.' },
        { ico: '🎬', title: 'Watch it happen', text: 'Tokens walk square by square, and each roll, landing, rent payment and card floats over the board as it happens.' },
      ],
    },
    {
      version: 'v0.10',
      date: '',
      title: 'Snakes and Ladders',
      items: [
        { ico: '🐍', title: 'Snakes and Ladders is playable', text: 'For 2 to 4 players, with bots filling empty seats. One tap to roll; ladders lift and snakes drop. Options: exact roll to finish, and roll again on a six.' },
      ],
    },
    {
      version: 'v0.9',
      date: '',
      title: 'Go Fish',
      items: [
        { ico: '🐟', title: 'Go Fish is playable', text: 'For 2 to 6 players, with bots filling empty seats. Ask for a rank you hold; books are laid down at once, and the most books wins. You only ever see your own hand.' },
      ],
    },
    {
      version: 'v0.8',
      date: '',
      title: 'A simpler home',
      items: [
        { ico: '🏡', title: 'A simpler home page', text: 'A greeting and a table code to join, then the games straight away. Friends appear as a compact card.' },
        { ico: '🔔', title: 'A notification bell', text: 'Shows a count of friend requests and table invitations, and lets you accept or decline them in place.' },
        { ico: '🚧', title: 'Coming soon', text: 'Upcoming games are listed as cards before their release.' },
      ],
    },
    {
      version: 'v0.7',
      date: '',
      title: 'Friends, private tables and host tools',
      items: [
        { ico: '🤝', title: 'Friends', text: 'Search players by username, send, accept, decline or cancel requests, and remove friends. Friends see whether you are online and which game you are playing.' },
        { ico: '🔒', title: 'Private tables', text: 'A new table is private: hidden from the public list, and its code is not an access grant. The host invites friends from the lobby. Make a table public to share its code.' },
        { ico: '🧰', title: 'Host tools', text: 'In the lobby the host can make another seated player the host, and remove a player, spectator or bot.' },
        { ico: '🖼️', title: 'Player cards and avatars', text: 'Tap anyone at a table for their name, ping, record and friend or mute actions. Pick a picture from the fixed set; it is saved to your account.' },
      ],
    },
    {
      version: 'v0.6',
      date: '',
      title: 'Profiles, history and account deletion',
      items: [
        { ico: '📊', title: 'Profiles and history', text: 'Your own profile shows your statistics and a paginated history of finished games. Anyone can see a public page with only public fields.' },
        { ico: '🗑️', title: 'Delete your account', text: 'Confirm with your password. Your sign-in and recent tables are removed; finished games stay, listed as Deleted player.' },
        { ico: '🕘', title: 'Recent tables and game logs', text: 'Recent tables follow your account across devices. Every game log shows who acted.' },
      ],
    },
  ];
})();
