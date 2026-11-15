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
      version: '2026-11-leave-and-reactions',
      date: '2026-11-15',
      title: 'Leaving, reactions and history',
      items: [
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
  ];
})();
