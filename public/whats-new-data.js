/*
 * What's new: the customer release history, newest first, grouped by date.
 *  - Each date lists its major updates in full. Minor updates are folded under "Show minor updates".
 *  - Only changes a player can see or use are listed. Admin-only work is not listed here.
 *  - The home What's new shows the first three major updates of the newest date.
 *  - What's new > All versions (also in the account menu) lists every date.
 * Keep the wording player-facing. An item with voice: true is hidden when voice chat is off.
 * Add a new date at the top when a change ships. The first date is the newest.
 */
(function () {
  window.TV_RELEASES = [
  {
    date: '2026-11-25',
    items: [
      {
        level: 'major',
        ico: '✅',
        title: 'Ready on every game',
        text: 'The Ready button sits in the same place at the bottom of the screen in every game, and the table stays still while you wait.'
      },
      {
        level: 'minor',
        ico: '🟠',
        title: 'Orange Ready means someone is still getting ready',
        text: 'The Ready button is orange while a seat has not pressed it yet.'
      },
      {
        level: 'minor',
        ico: '🃏',
        title: 'Wizard on short phones shows the trump',
        text: 'When a Wizard is turned up, the trump suit stays in view on a small phone.'
      },
      {
        level: 'minor',
        ico: '📖',
        title: 'How-to cards keep one size',
        text: 'The box does not change size from card to card in a game’s how-to.'
      }
    ]
  },
  {
    date: '2026-11-24',
    items: [
      {
        level: 'major',
        ico: '🎨',
        title: 'Appearance: Dark, Light or Follow system',
        text: 'Choose the look in Settings. It is remembered on this device.'
      },
      {
        level: 'major',
        ico: '✉️',
        title: 'Confirm your email to play',
        text: 'Registered accounts confirm their email address before they can play.'
      },
      {
        level: 'minor',
        ico: '🔁',
        title: 'Your details stay when something fails',
        text: 'If a sign-in or sign-up request fails, what you typed stays on the form.'
      },
      {
        level: 'minor',
        ico: '🔑',
        title: 'Passwords: at least 8 characters',
        text: 'Use at least 8 characters. You do not need to mix letters and numbers.'
      },
      {
        level: 'minor',
        ico: '🔗',
        title: 'Invite links are easier to find',
        text: 'Copy the invite link, WhatsApp or Share sit above the table’s visibility setting. Private tables also show the friend invitation form.'
      },
      {
        level: 'minor',
        ico: '🟢',
        title: 'Round end: steady Ready',
        text: 'Tapping Ready no longer makes the score card flicker, and the box says the next round is starting once everybody is ready.'
      },
      {
        level: 'minor',
        ico: '♠️',
        title: 'Twenty-Nine and Poker: red and black suits',
        text: 'Hearts and diamonds are red, and spades and clubs are black, so the suits are easy to read.'
      },
      {
        level: 'minor',
        ico: '⛏️',
        title: 'Hidden Miners looks richer',
        text: 'Carved tunnel tiles, textured cards and lamplight glass panels.'
      },
      {
        level: 'minor',
        ico: '🐍',
        title: 'Snakes and Ladders: more realistic snakes',
        text: 'The snakes are drawn with more detail.'
      },
      {
        level: 'minor',
        ico: '💣',
        title: 'Take 5: every bomb shows on a phone',
        text: 'Each bomb is visible on a small screen.'
      },
      {
        level: 'minor',
        ico: '🖼️',
        title: 'How-to pictures for each game',
        text: 'Each game’s how-to shows a picture of the game.'
      },
      {
        level: 'minor',
        ico: '📱',
        title: 'Smoother layouts on phones',
        text: 'Buttons and tables fit better on small screens.'
      },
      {
        level: 'minor',
        ico: '⚡',
        title: 'Game-over ratings arrive sooner',
        text: 'The rating changes after a game are ready faster.'
      }
    ]
  },
  {
    date: '2026-11-23',
    items: [
      {
        level: 'major',
        ico: '✨',
        title: 'A fresh look',
        text: 'New colours, lettering, buttons and game cards across the app.'
      },
      {
        level: 'minor',
        ico: '🎲',
        title: 'Ludo: larger pieces on phones',
        text: 'Your pieces are easier to tap.'
      },
      {
        level: 'minor',
        ico: '🎨',
        title: 'Ludo: your turn bar takes your colour',
        text: 'On your move, the turn bar shows your colour.'
      },
      {
        level: 'minor',
        ico: '⏳',
        title: 'Clear loading for slower requests',
        text: 'A short loading veil shows when something takes a moment, instead of a blank screen.'
      },
      {
        level: 'minor',
        ico: '📊',
        title: 'Game-over scorecard shows ratings when ready',
        text: 'Ratings fill in as soon as they arrive.'
      },
      {
        level: 'minor',
        ico: '👤',
        title: 'Profiles show skill ratings',
        text: 'The old “Highest score” is no longer shown.'
      }
    ]
  },
  {
    date: '2026-11-22',
    items: [
      {
        level: 'major',
        ico: '✅',
        title: 'Ready is where you need it',
        text: 'Between rounds, Ready sits in the round summary with the scores. At the start of a round it takes the place of the bid or the status line, so it never covers the table.'
      },
      {
        level: 'minor',
        ico: '🎲',
        title: 'Ludo shows every roll',
        text: 'The last roll stays on the dice, even when it cannot be played. Sixes, captured tokens and tokens reaching home are announced, and the latest moves float over the board.'
      },
      {
        level: 'minor',
        ico: '🎣',
        title: 'Go Fish keeps a short feed',
        text: 'The last asks stay on screen, and a book or a catch that involves you is announced.'
      },
      {
        level: 'minor',
        ico: '⛏️',
        title: 'Hidden Miners pauses between rounds',
        text: 'After each round everyone sees the chambers and the scores, then presses Ready for the next one.'
      },
      {
        level: 'major',
        ico: '📈',
        title: 'Skill ratings for every game',
        text: 'Each game has a skill rating that goes up when you beat stronger players. Boards show lifetime and this month, and you choose whether your name appears on them.'
      },
      {
        level: 'minor',
        ico: '👋',
        title: 'Welcome back',
        text: 'A home card greets returning players.'
      },
      {
        level: 'minor',
        ico: '📣',
        title: 'Feeds and pace',
        text: 'Hidden Miners shows a public move log and tallies per miner. Tables run a little slower, and the last big moment stays on screen longer.'
      },
      {
        level: 'minor',
        ico: '🏦',
        title: 'Property Rivals: confirm bankruptcy',
        text: 'Declaring bankruptcy asks for a second tap.'
      },
      {
        level: 'minor',
        ico: '🪑',
        title: 'Seats keep the same size',
        text: 'Wizard and 29 keep their seats the same size when the status line changes.'
      }
    ]
  },
  {
    date: '2026-11-21',
    items: [
      {
        level: 'major',
        ico: '🎨',
        title: 'Color Clash',
        text: 'Match the colour or the number and be first to empty your hand. Stop, Flip, Take 2 and Wild cards shake things up. Two to eight players, with bots, and a score that adds up over the rounds.'
      },
      {
        level: 'major',
        ico: '⛏️',
        title: 'Hidden Miners',
        text: 'Dig a tunnel toward the gold, but someone at the table is secretly a Saboteur. Break and repair tools, scout the chambers and collapse tunnels. Three to eight players.'
      },
      {
        level: 'minor',
        ico: '📱',
        title: 'More room on phones',
        text: 'The main buttons are a little smaller on a phone, so the table and your cards get more space.'
      },
      {
        level: 'minor',
        ico: '🔀',
        title: 'Host swaps seats and shuffles',
        text: 'In every game where seats matter, the host can swap seats or shuffle them in the lobby.'
      }
    ]
  },
  {
    date: '2026-11-20',
    items: [
      {
        level: 'major',
        ico: '🎲',
        title: 'Twelve games, open by default',
        text: 'Go Fish, Ludo, Take 5, Poker, Property Rivals, Snakes and Ladders, Stage 10, Mind, 29, Wizard, Tic-Tac-Toe and Four in a Row are open to every player unless the owner has limited one. A game that is closed to you is greyed out on the home page as unavailable.'
      },
      {
        level: 'minor',
        ico: '🖼️',
        title: 'Every game has its own logo',
        text: 'Each game has a mark of its own. It looks the same on the home page, in open tables, in your history and in the stats.'
      },
      {
        level: 'minor',
        ico: '🏠',
        title: 'Open tables above the games',
        text: 'Open tables are listed at the top of the home page, so you can join one straight away. On a phone they sit in two rows that scroll sideways. On a wide screen they sit beside the games.'
      },
      {
        level: 'minor',
        ico: '🃏',
        title: 'Take 5 has new card art',
        text: 'Each card shows its number in the corners, and its penalty points as stars, so you can read the risk at a glance. Up to eight players.'
      },
      {
        level: 'minor',
        ico: '🪜',
        title: 'Stage 10 shows every stage',
        text: 'Each player’s current stage is shown at the table, like the bids in Wizard. The cards are easier to tell apart, and a Phases sheet explains every stage.'
      },
      {
        level: 'minor',
        ico: '♠️',
        title: 'Poker hand rankings',
        text: 'Open the hand rankings sheet at the table to see which hands beat which.'
      },
      {
        level: 'major',
        ico: '♟️',
        title: 'Chess for two',
        text: 'Full chess rules for two players, with a board that works on phones.'
      },
      {
        level: 'minor',
        ico: '🎬',
        title: 'Take 5 and Stage 10 show what happened',
        text: 'A short feed shows the key moves, and the scores stay easy to follow.'
      },
      {
        level: 'minor',
        ico: '🏁',
        title: 'The end of a game waits for the last move',
        text: 'The end-of-game pop-up appears once the final move has been played out.'
      },
      {
        level: 'minor',
        ico: '🎯',
        title: 'Line games move more smoothly',
        text: 'Each move finishes its animation, and the sound plays as the piece lands.'
      }
    ]
  },
  {
    date: '2026-11-19',
    items: [
      {
        level: 'major',
        ico: '🏷️',
        title: 'Three games have new names',
        text: 'Penalty Rows is now Take 5, Stage Rummy is now Stage 10, and The Mind is now Mind. The games play exactly the same, and your matches and stats are all still there.'
      },
      {
        level: 'minor',
        ico: '🔲',
        title: 'Tic-Tac-Toe and Four in a Row are sharper',
        text: 'Tic-Tac-Toe squares are fixed in size, and Four in a Row moves more smoothly.'
      },
      {
        level: 'minor',
        ico: '📜',
        title: 'Clearer rules',
        text: '29 bidding order, the marriage threshold, cancelled rounds and challenge wording are clearer. Snakes and Ladders gets an extra roll on a six.'
      }
    ]
  },
  {
    date: '2026-11-18',
    items: [
      {
        level: 'major',
        ico: '👋',
        title: 'Play without an account',
        text: 'Try a game as a guest from the home page. A guest visit lasts a few days in this browser, and you can turn it into a full account at any time without losing your games.'
      },
      {
        level: 'minor',
        ico: '🔒',
        title: 'Some games need an account',
        text: 'The owner can keep a game for registered players only. Where that applies to you, the game shows a note and you can create an account from it.'
      },
      {
        level: 'minor',
        ico: '🔔',
        title: 'Quiet reminders',
        text: 'Guests see a short reminder that an account keeps their progress. It never interrupts a game, and you can dismiss it.'
      }
    ]
  },
  {
    date: '2026-11-17',
    items: [
      {
        level: 'minor',
        ico: '🎉',
        title: 'Level-up dialog',
        text: 'When you reach a new level, the next time you open the menu shows your new level and how much XP is left to the next one.'
      }
    ]
  },
  {
    date: '2026-11-15',
    items: [
      {
        level: 'major',
        ico: '⭐',
        title: 'See how far you are to the next level',
        text: 'Your profile shows your level, the minutes played and how many more you need to reach the next one.'
      },
      {
        level: 'minor',
        ico: '🎉',
        title: 'A level-up notice, once',
        text: 'When you reach a new level you see a short notice with the new level. Tap Got it and it will not show again for that level on this device.'
      },
      {
        level: 'minor',
        ico: '📸',
        title: 'Follow @playtableverse on Instagram',
        text: 'The home page footer has a link to our Instagram account, which opens in a new tab.'
      },
      {
        level: 'minor',
        ico: '↩️',
        title: 'Take your seat back within two minutes',
        text: 'If you leave a running game on purpose, you can take your seat back within two minutes of your first departure, and the penalty goes. After that a bot keeps the seat and you can watch. A dropped connection does not count as leaving. Your play time counts only while you are seated and connected.'
      },
      {
        level: 'major',
        ico: '🚪',
        title: 'Leaving a game with others counts as a loss',
        text: 'If other people are still playing, leaving asks first. If the game then finishes, it counts as a loss for you. If a second player also leaves, the game is abandoned: nobody is penalised, and the people who stayed get no result. Playing only against bots, leaving does not count.'
      },
      {
        level: 'minor',
        ico: '😀',
        title: 'More reactions, and spectators can react',
        text: 'There are 21 reactions now. A spectator’s reaction shows their name with a 👁, so the table knows it came from someone watching.'
      },
      {
        level: 'minor',
        ico: '🧾',
        title: 'Your history says why a game counted',
        text: 'Each game in your history shows whether you won, lost or drew, or whether you left and how that counted. Leaving against bots only is listed but not counted.'
      },
      {
        level: 'minor',
        ico: '🎲',
        title: '29 rule options start on in a new table',
        text: 'The rule options for 29 and Shuffle seats for Wizard start switched on. The host can still change them in the lobby.'
      },
      {
        level: 'minor',
        ico: '🃏',
        title: '29: one answer decides for the whole side',
        text: 'The whole answering side may double, redouble or accept, and one answer decides for both players.'
      },
      {
        level: 'minor',
        ico: '🚫',
        title: 'Blocking is quicker and clearer',
        text: 'Block and unblock send one request at a time, and an error names the action that failed.'
      },
      {
        level: 'minor',
        ico: '🟢',
        title: 'Ludo: the seat to play blinks',
        text: 'With six players, the outer yard of the seat to play blinks.'
      },
      {
        level: 'minor',
        ico: '🏆',
        title: 'Weekly boards, if you want them',
        text: 'Each game has a weekly board. You choose whether your name appears on it.'
      }
    ]
  },
  {
    date: '2026-11-14',
    items: [
      {
        level: 'minor',
        ico: '🌍',
        title: 'New tables are public by default',
        text: 'They appear in the open tables. To make a table private, use Make private in its lobby (it is not offered once a game has started). Members and spectators already at the table keep access.'
      },
      {
        level: 'minor',
        ico: '🃏',
        title: '29 on phones keeps the trump in view',
        text: 'The trump suit, or that it is still hidden or not yet chosen, stays on screen during play.'
      },
      {
        level: 'minor',
        ico: '🔐',
        title: 'Keep me signed in on this device',
        text: 'An optional tick on the sign-in form keeps this browser signed in for 30 days after its last visit. It ends when you sign out, sign out everywhere, reset your password, or an owner suspends your account.'
      },
      {
        level: 'minor',
        ico: '🏙️',
        title: 'Property Rivals: tap a city for its details',
        text: 'Its owner, buildings, rent now, the full rent table, and the mortgage, unmortgage and house costs.'
      },
      {
        level: 'minor',
        ico: '👑',
        title: 'Property Rivals: the crown follows net worth',
        text: 'Each player shows cash and net worth separately. The crown marks the highest net worth, not the most cash.'
      },
      {
        level: 'minor',
        ico: '⚙️',
        title: 'Game settings are always at the top right',
        text: 'Tap them for the full list, with each choice explained.'
      },
      {
        level: 'minor',
        ico: '🔇',
        title: 'Blocking hides chat and voice',
        text: 'A block hides the blocked player’s table chat and voice and stops invitations between you. It no longer removes anyone from a table, so blocked players can share one.'
      },
      {
        level: 'minor',
        ico: '🚩',
        title: 'Block and report players',
        text: 'From a table card or a profile page. A report has a reason and is stored once per reporter and player.'
      },
      {
        level: 'minor',
        ico: '📖',
        title: 'Game settings explain the 29 options',
        text: 'Wizard and 29 have a host-controlled Shuffle seats option.'
      },
      {
        level: 'minor',
        ico: '⋯',
        title: 'How to play, the game log and settings are in ⋯',
        text: 'They are in the ⋯ menu, so the bottom bar stays clear.'
      }
    ]
  },
  {
    date: '',
    label: 'Earlier versions',
    items: [
      {
        level: 'major',
        ico: '🎙️',
        title: 'Talk with your table',
        text: 'In-browser voice chat in the lobby and during games.',
        voice: true
      },
      {
        level: 'major',
        ico: '🔇',
        title: 'Mute, or listen without speaking',
        text: 'Mute your microphone, or join to listen only.',
        voice: true
      },
      {
        level: 'major',
        ico: '👥',
        title: 'See who is speaking',
        text: 'See who has joined voice and who is talking right now. Up to eight people per table.',
        voice: true
      },
      {
        level: 'major',
        ico: '🌐',
        title: 'No app to install',
        text: 'Use Tableverse over HTTPS and allow microphone access. Voice starts off and is only on when you choose to join. Audio is peer-to-peer, so connection quality can vary, and other participants may learn connection information such as IP addresses.',
        voice: true
      },
      {
        level: 'minor',
        ico: '💬',
        title: 'Floating messages',
        text: 'New public log lines (a bid, a raise, a capture, a mistake, a rent payment) float over the table for a few seconds in Wizard, 29, Poker, Ludo, Mind and Property Rivals. Snakes and Ladders keeps its move banner; Go Fish has no log.'
      },
      {
        level: 'minor',
        ico: '👑',
        title: 'A crown for who is ahead',
        text: 'Every scoring game shows it: Wizard, Poker (three or more players), 29 (team score), Go Fish, Snakes and Ladders, Ludo and Property Rivals.'
      },
      {
        level: 'major',
        ico: '⭕',
        title: 'Tic-Tac-Toe',
        text: 'A 3×3 board for two players. A full board with no line is a draw. Bots play perfectly.'
      },
      {
        level: 'major',
        ico: '🔴',
        title: 'Four in a Row, and Five in a Row',
        text: 'Drop discs into a 7×6 grid to connect four. Set Line length to five for Five in a Row on a 9×8 grid. Options include who starts.'
      },
      {
        level: 'major',
        ico: '🏠',
        title: 'Property Rivals is playable',
        text: 'For 2 to 6 players, with bots filling empty seats. A 40-square board with 22 cities, 4 ports and 2 utilities. Rent doubles on a full colour set, buildings go up to a hotel, properties mortgage, unsold properties go to auction, players trade, and there are Surprise and Community Fund cards.'
      },
      {
        level: 'minor',
        ico: '🎲',
        title: 'Options',
        text: 'A short game (30 or 60 rounds, richest wins), starting cash, auctions on or off, and a Rest Stop jackpot.'
      },
      {
        level: 'minor',
        ico: '🎬',
        title: 'Watch it happen',
        text: 'Tokens walk square by square, and each roll, landing, rent payment and card floats over the board as it happens.'
      },
      {
        level: 'major',
        ico: '🐍',
        title: 'Snakes and Ladders is playable',
        text: 'For 2 to 4 players, with bots filling empty seats. One tap to roll; ladders lift and snakes drop. Options: exact roll to finish, and roll again on a six.'
      },
      {
        level: 'major',
        ico: '🐟',
        title: 'Go Fish is playable',
        text: 'For 2 to 6 players, with bots filling empty seats. Ask for a rank you hold; books are laid down at once, and the most books wins. You only ever see your own hand.'
      },
      {
        level: 'major',
        ico: '🏡',
        title: 'A simpler home page',
        text: 'A greeting and a table code to join, then the games straight away. Friends appear as a compact card.'
      },
      {
        level: 'minor',
        ico: '🔔',
        title: 'A notification bell',
        text: 'Shows a count of friend requests and table invitations, and lets you accept or decline them in place.'
      },
      {
        level: 'major',
        ico: '🤝',
        title: 'Friends',
        text: 'Search players by username, send, accept, decline or cancel requests, and remove friends. Friends see whether you are online and which game you are playing.'
      },
      {
        level: 'major',
        ico: '🔒',
        title: 'Private tables',
        text: 'A new table is private: hidden from the public list, and its code is not an access grant. The host invites friends from the lobby. Make a table public to share its code.'
      },
      {
        level: 'minor',
        ico: '🧰',
        title: 'Host tools',
        text: 'In the lobby the host can make another seated player the host, and remove a player, spectator or bot.'
      },
      {
        level: 'minor',
        ico: '🖼️',
        title: 'Player cards and avatars',
        text: 'Tap anyone at a table for their name, ping, record and friend or mute actions. Pick a picture from the fixed set; it is saved to your account.'
      },
      {
        level: 'major',
        ico: '📊',
        title: 'Profiles and history',
        text: 'Your own profile shows your statistics and a paginated history of finished games. Anyone can see a public page with only public fields.'
      },
      {
        level: 'major',
        ico: '🗑️',
        title: 'Delete your account',
        text: 'Confirm with your password. Your sign-in and recent tables are removed; finished games stay, listed as Deleted player.'
      },
      {
        level: 'minor',
        ico: '🕘',
        title: 'Recent tables and game logs',
        text: 'Recent tables follow your account across devices. Every game log shows who acted.'
      }
    ]
  }
];
})();
