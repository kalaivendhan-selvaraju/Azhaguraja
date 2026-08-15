require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const {
  LavalinkManager
} = require("lavalink-client");

// ======================================================
// ENV
// ======================================================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const LAVALINK_HOST =
  process.env.LAVALINK_HOST;

const LAVALINK_PORT =
  Number(process.env.LAVALINK_PORT || 443);

const LAVALINK_PASSWORD =
  process.env.LAVALINK_PASSWORD;

const LAVALINK_SECURE =
  process.env.LAVALINK_SECURE === "true";

if (!TOKEN) {
  console.error("❌ TOKEN missing in .env");
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID missing in .env");
}

if (!LAVALINK_HOST) {
  console.error("❌ LAVALINK_HOST missing in .env");
}

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ======================================================
// MUSIC STATE
// ======================================================

const musicState = new Map();

function getMusicState(guildId) {
  if (!musicState.has(guildId)) {
    musicState.set(guildId, {
      volume: 100,
      shuffle: false,
      loop: false
    });
  }

  return musicState.get(guildId);
}

// ======================================================
// MUSIC PLAYER MESSAGE
// ======================================================

const musicMessages = new Map();

/*
guildId -> {
    message,
    channelId
}
*/

// ======================================================
// TIMER STATE
// ======================================================

const musicTimers = new Map();

/*
guildId -> {
    interval,
    basePosition,
    startedAt,
    trackIdentifier,
    updating
}
*/

// ======================================================
// LAVALINK
// ======================================================

const lavalink = new LavalinkManager({
  nodes: [
    {
      id: "PublicNode",

      host: LAVALINK_HOST,

      port: LAVALINK_PORT,

      authorization: LAVALINK_PASSWORD,

      secure: LAVALINK_SECURE,

      retryAmount: 5,

      retryDelay: 10000
    }
  ],

  sendToShard: (guildId, payload) => {
    const guild =
      client.guilds.cache.get(guildId);

    if (guild) {
      guild.shard.send(payload);
    }
  },

  autoSkip: true,

  client: {
    id: CLIENT_ID,
    username: "Music Bot"
  },

  playerOptions: {
    defaultSearchPlatform: "ytsearch",

    clientBasedPositionUpdateInterval: 50,

    onDisconnect: {
      autoReconnect: true,
      destroyPlayer: false
    },

    onEmptyQueue: {
      destroyAfterMs: 30000
    }
  },

  queueOptions: {
    maxPreviousTracks: 10
  }
});

client.lavalink = lavalink;

// ======================================================
// DISCORD RAW VOICE DATA
// ======================================================

client.on("raw", data => {
  client.lavalink.sendRawData(data);
});

// ======================================================
// LAVALINK EVENTS
// ======================================================

client.lavalink.nodeManager.on(
  "connect",
  node => {
    console.log(
      `🟢 Lavalink connected: ${node.id}`
    );
  }
);

client.lavalink.nodeManager.on(
  "disconnect",
  (node, reason) => {
    console.log(
      `🔴 Lavalink disconnected: ${node.id}`
    );

    console.log(reason);
  }
);

client.lavalink.nodeManager.on(
  "reconnecting",
  node => {
    console.log(
      `🟡 Lavalink reconnecting: ${node.id}`
    );
  }
);

client.lavalink.nodeManager.on(
  "error",
  (node, error) => {
    console.error(
      `❌ Lavalink error: ${node.id}`
    );

    console.error(error);
  }
);

// ======================================================
// READY
// ======================================================

client.once("clientReady", async () => {
  console.log(
    `🤖 Logged in as ${client.user.tag}`
  );

  try {
    await client.lavalink.init({
      ...client.user
    });

    console.log(
      "✅ Lavalink initialized"
    );
  } catch (error) {
    console.error(
      "❌ Lavalink initialization failed:"
    );

    console.error(error);
  }
});

// ======================================================
// FORMAT TIME
// ======================================================

function formatTime(ms) {
  ms = Math.max(
    0,
    Number(ms || 0)
  );

  const totalSeconds =
    Math.floor(ms / 1000);

  const hours =
    Math.floor(
      totalSeconds / 3600
    );

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const seconds =
    totalSeconds % 60;

  if (hours > 0) {
    return (
      `${String(hours).padStart(2, "0")}:` +
      `${String(minutes).padStart(2, "0")}:` +
      `${String(seconds).padStart(2, "0")}`
    );
  }

  return (
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`
  );
}

// ======================================================
// PROGRESS BAR
// ======================================================

function progressBar(position, duration) {
  if (!duration || duration <= 0) {
    return "🔘━━━━━━━━━━━━";
  }

  const blocks = 13;

  const percentage =
    Math.max(
      0,
      Math.min(
        1,
        position / duration
      )
    );

  const current =
    Math.min(
      blocks - 1,
      Math.floor(
        percentage * blocks
      )
    );

  let bar = "";

  for (let i = 0; i < blocks; i++) {
    if (i === current) {
      bar += "🔘";
    } else {
      bar += "▬";
    }
  }

  return bar;
}

// ======================================================
// TIMER STATE
// ======================================================

function getTimerState(guildId) {
  if (!musicTimers.has(guildId)) {
    musicTimers.set(
      guildId,
      {
        interval: null,

        basePosition: 0,

        startedAt: 0,

        trackIdentifier: null,

        updating: false
      }
    );
  }

  return musicTimers.get(guildId);
}

// ======================================================
// SYNC TIMER
// ======================================================

function syncMusicPosition(player) {
  const timer =
    getTimerState(
      player.guildId
    );

  const track =
    player.queue.current;

  timer.basePosition =
    Number(
      player.position || 0
    );

  timer.startedAt =
    Date.now();

  timer.trackIdentifier =
    track?.info?.identifier ||
    track?.info?.uri ||
    null;
}

// ======================================================
// GET DISPLAY POSITION
// ======================================================

function getDisplayPosition(player) {
  const timer =
    getTimerState(
      player.guildId
    );

  const track =
    player.queue.current;

  if (!track) {
    return 0;
  }

  const duration =
    Number(
      track.info.duration || 0
    );

  const identifier =
    track.info.identifier ||
    track.info.uri ||
    null;

  // NEW TRACK
  if (
    timer.trackIdentifier !==
    identifier
  ) {
    syncMusicPosition(player);

    return Number(
      player.position || 0
    );
  }

  // PAUSED
  if (player.paused) {
    return timer.basePosition;
  }

  // PLAYING
  const elapsed =
    Date.now() -
    timer.startedAt;

  let position =
    timer.basePosition +
    elapsed;

  if (duration > 0) {
    position =
      Math.min(
        position,
        duration
      );
  }

  return Math.max(
    0,
    position
  );
}

// ======================================================
// STOP TIMER
// ======================================================

function stopMusicTimer(guildId) {
  const timer =
    musicTimers.get(guildId);

  if (!timer) {
    return;
  }

  if (timer.interval) {
    clearInterval(
      timer.interval
    );
  }

  musicTimers.delete(guildId);
}

// ======================================================
// START TIMER
// ======================================================

function startMusicTimer(player) {
  const guildId =
    player.guildId;

  const timer =
    getTimerState(guildId);

  if (timer.interval) {
    return;
  }

  if (!timer.startedAt) {
    syncMusicPosition(player);
  }

  timer.interval =
    setInterval(
      async () => {

        const currentPlayer =
          client.lavalink.players.get(
            guildId
          );

        if (!currentPlayer) {
          stopMusicTimer(guildId);
          return;
        }

        if (
          !musicMessages.has(
            guildId
          )
        ) {
          return;
        }

        // IMPORTANT:
        // Do not update timer while paused.
        if (currentPlayer.paused) {
          return;
        }

        if (timer.updating) {
          return;
        }

        timer.updating = true;

        try {
          const position =
            getDisplayPosition(
              currentPlayer
            );

          await updateMusicUI(
            currentPlayer,
            position
          );
        } catch (error) {
          console.error(
            "❌ Timer error:",
            error.message
          );
        } finally {
          timer.updating = false;
        }
      },
      5000
    );
}

// ======================================================
// MUSIC BUTTONS
// ======================================================

function musicButtons() {
  const row1 =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "music_previous"
          )
          .setEmoji("⏮️")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "music_pause"
          )
          .setEmoji("⏯️")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "music_skip"
          )
          .setEmoji("⏭️")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "music_stop"
          )
          .setEmoji("⏹️")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "music_refresh"
          )
          .setEmoji("🔄")
          .setStyle(
            ButtonStyle.Secondary
          )
      );

  const row2 =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "music_volume_down"
          )
          .setEmoji("🔉")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "music_volume_up"
          )
          .setEmoji("🔊")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "music_shuffle"
          )
          .setEmoji("🔀")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "music_loop"
          )
          .setEmoji("🔁")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "music_queue"
          )
          .setEmoji("📋")
          .setStyle(
            ButtonStyle.Secondary
          )
      );

  return [
    row1,
    row2
  ];
}

// ======================================================
// MUSIC EMBED
// ======================================================

function createMusicEmbed(
  player,
  displayPosition = null
) {
  const state =
    getMusicState(
      player.guildId
    );

  const track =
    player.queue.current;

  if (!track) {
    return new EmbedBuilder()
      .setColor("#5865F2")

      .setTitle(
        "🎵 MUSIC PLAYER"
      )

      .setDescription(
        [
          "## 🎶 Nothing is playing",

          "",

          "Use `/play` to start music.",

          "",

          "🎧 **YouTube Music**",

          "📋 **YouTube Playlists Supported**",

          "",

          "━━━━━━━━━━━━━━━━━━━━",

          "",

          "⏮️ Previous",
          "⏯️ Pause / Resume",
          "⏭️ Skip",
          "⏹️ Stop",
          "🔄 Refresh",
          "🔀 Shuffle",
          "🔁 Loop",
          "📋 Queue"
        ].join("\n")
      )

      .setFooter({
        text:
          "YouTube • Lavalink"
      });
  }

  const position =
    displayPosition !== null
      ? displayPosition
      : Number(
          player.position || 0
        );

  const duration =
    Number(
      track.info.duration || 0
    );

  const status =
    player.paused
      ? "⏸️ PAUSED"
      : "▶️ PLAYING";

  const queueLength =
    player.queue.tracks.length;

  const shuffle =
    state.shuffle
      ? "🟢 ON"
      : "🔴 OFF";

  const loop =
    state.loop
      ? "🟢 ON"
      : "🔴 OFF";

  return new EmbedBuilder()
    .setColor("#5865F2")

    .setTitle(
      "🎵 MUSIC PLAYER"
    )

    .setDescription(
      [
        `## 🎶 ${track.info.title}`,

        `👤 **${track.info.author || "Unknown"}**`,

        "",

        progressBar(
          position,
          duration
        ),

        `\`${formatTime(position)} / ${formatTime(duration)}\``,

        "",

        `### ${status}`,

        `🔊 Volume: **${state.volume}%**`,

        `🔀 Shuffle: **${shuffle}**`,

        `🔁 Loop: **${loop}**`,

        "",

        `📋 Queue: **${queueLength}**`,

        "",

        "━━━━━━━━━━━━━━━━━━━━",

        "🎛️ **Music Controls**"
      ].join("\n")
    )

    .setThumbnail(
      track.info.artworkUrl || null
    )

    .setFooter({
      text:
        "YouTube • Lavalink Music Player"
    })

    .setTimestamp();
}

// ======================================================
// UPDATE MUSIC UI
// ======================================================

async function updateMusicUI(
  player,
  forcedPosition = null
) {
  const guildId =
    player.guildId;

  const data =
    musicMessages.get(
      guildId
    );

  if (!data) {
    return;
  }

  const position =
    forcedPosition !== null
      ? forcedPosition
      : getDisplayPosition(
          player
        );

  try {
    await data.message.edit({
      embeds: [
        createMusicEmbed(
          player,
          position
        )
      ],

      components:
        musicButtons()
    });
  } catch (error) {

    if (
      error.code === 10008
    ) {
      musicMessages.delete(
        guildId
      );

      stopMusicTimer(
        guildId
      );

      return;
    }

    console.error(
      "❌ Music UI error:",
      error.message
    );
  }
}

// ======================================================
// CREATE MUSIC UI
// ======================================================

async function createMusicUI(
  interaction,
  player
) {
  const guildId =
    interaction.guildId;

  const existing =
    musicMessages.get(
      guildId
    );

  if (existing) {
    const position =
      getDisplayPosition(
        player
      );

    await updateMusicUI(
      player,
      position
    );

    startMusicTimer(player);

    return existing.message;
  }

  const message =
    await interaction.channel.send({
      embeds: [
        createMusicEmbed(
          player
        )
      ],

      components:
        musicButtons()
    });

  musicMessages.set(
    guildId,
    {
      message,
      channelId:
        interaction.channelId
    }
  );

  syncMusicPosition(
    player
  );

  startMusicTimer(
    player
  );

  return message;
}

// ======================================================
// GET PLAYER
// ======================================================

async function getPlayer(
  interaction
) {
  const voiceChannel =
    interaction.member.voice.channel;

  if (!voiceChannel) {
    throw new Error(
      "NO_VOICE"
    );
  }

  let player =
    client.lavalink.players.get(
      interaction.guildId
    );

  if (!player) {
    player =
      client.lavalink.createPlayer({
        guildId:
          interaction.guildId,

        voiceChannelId:
          voiceChannel.id,

        textChannelId:
          interaction.channelId,

        selfDeaf: true,

        volume:
          getMusicState(
            interaction.guildId
          ).volume
      });
  } else {

    if (
      player.voiceChannelId &&
      player.voiceChannelId !==
        voiceChannel.id
    ) {
      throw new Error(
        "WRONG_VOICE"
      );
    }
  }

  if (!player.connected) {
    await player.connect();
  }

  return player;
}

// ======================================================
// PLAY
// ======================================================

async function handlePlay(
  interaction
) {
  const query =
    interaction.options.getString(
      "song"
    );

  await interaction.deferReply();

  try {

    const player =
      await getPlayer(
        interaction
      );

    const result =
      await player.search(
        {
          query,
          source: "youtube"
        },
        interaction.user
      );

    if (
      !result ||
      !result.tracks ||
      result.tracks.length === 0
    ) {
      return interaction.editReply(
        "❌ YouTube song / playlist kedaikala da!"
      );
    }

    // ==================================================
    // PLAYLIST
    // ==================================================

    if (
      result.loadType ===
      "playlist"
    ) {

      for (
        const track of result.tracks
      ) {
        player.queue.add(track);
      }

      if (
        !player.playing &&
        !player.paused
      ) {
        await player.play();
      }

      const playlistName =
        result.playlist?.name ||
        "YouTube Playlist";

      const embed =
        new EmbedBuilder()
          .setColor("#FF0000")

          .setAuthor({
            name: "PLAYLIST ADDED",
            iconURL: "https://cdn.discordapp.com/emojis/741605543046807626.gif"
          })

          .setDescription(
            [
              `## 🎶 ${playlistName}`,

              "",

              `✅ **${result.tracks.length}** songs added`,

              "",

              "▶️ Playback started",

              "",

              "🎵 Music Player updated automatically."
            ].join("\n")
          )

          .setFooter({
            text:
              `Requested by ${interaction.user.username}`
          });

      await interaction.editReply({
        embeds: [
          embed
        ]
      });

      await createMusicUI(
        interaction,
        player
      );

      return;
    }

    // ==================================================
    // SINGLE SONG
    // ==================================================

    const track =
      result.tracks[0];

    player.queue.add(track);

    if (
      !player.playing &&
      !player.paused
    ) {
      await player.play();
    }

    const embed =
      new EmbedBuilder()
        .setColor("#FF0000")

        .setTitle(
          "🎵 ADDED TO QUEUE"
        )

        .setDescription(
          [
            `## ${track.info.title}`,

            "",

            `👤 **${track.info.author || "Unknown"}**`,

            "",

            "🎧 YouTube",

            "",

            "🎵 Added to Music Player"
          ].join("\n")
        )

        .setThumbnail(
          track.info.artworkUrl || null
        )

        .setFooter({
          text:
            `Requested by ${interaction.user.username}`
        });

    await interaction.editReply({
      embeds: [
        embed
      ]
    });

    await createMusicUI(
      interaction,
      player
    );

  } catch (error) {

    console.error(
      "❌ PLAY ERROR:",
      error
    );

    if (
      error.message ===
      "NO_VOICE"
    ) {
      return interaction.editReply(
        "🎤 First join a voice channel da!"
      );
    }

    if (
      error.message ===
      "WRONG_VOICE"
    ) {
      return interaction.editReply(
        "❌ I am already playing in another voice channel."
      );
    }

    return interaction.editReply(
      `❌ Error: ${error.message}`
    );
  }
}

// ======================================================
// SHUFFLE
// ======================================================

function shuffleQueue(player) {
  const tracks =
    player.queue.tracks;

  if (
    !tracks ||
    tracks.length < 2
  ) {
    return false;
  }

  for (
    let i = tracks.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );

    [
      tracks[i],
      tracks[j]
    ] = [
      tracks[j],
      tracks[i]
    ];
  }

  return true;
}

// ======================================================
// QUEUE EMBED
// ======================================================

function createQueueEmbed(
  player
) {
  const current =
    player.queue.current;

  const tracks =
    player.queue.tracks || [];

  let description = "";

  if (current) {
    description += [
      "## 🎵 NOW PLAYING",

      "",

      `**${current.info.title}**`,

      `👤 ${current.info.author || "Unknown"}`,

      ""
    ].join("\n");
  }

  if (tracks.length > 0) {

    description +=
      "## 📋 UP NEXT\n\n";

    tracks
      .slice(0, 15)
      .forEach(
        (
          track,
          index
        ) => {

          description +=
            `\`${index + 1}.\` ${track.info.title}\n`;
        }
      );

    if (
      tracks.length > 15
    ) {
      description +=
        `\n...and **${tracks.length - 15}** more.`;
    }

  } else {
    description +=
      "✨ No songs waiting.";
  }

  return new EmbedBuilder()
    .setColor("#5865F2")

    .setTitle(
      "📋 MUSIC QUEUE"
    )

    .setDescription(
      description
    )

    .setFooter({
      text:
        `${tracks.length} song${tracks.length === 1 ? "" : "s"} waiting`
    });
}

// ======================================================
// BUTTON HANDLER
// ======================================================

async function handleButton(
  interaction
) {
  const player =
    client.lavalink.players.get(
      interaction.guildId
    );

  if (!player) {
    return interaction.reply({
      content:
        "❌ No music player running.",
      ephemeral: true
    });
  }

  const voiceChannel =
    interaction.member.voice.channel;

  if (
    !voiceChannel ||
    voiceChannel.id !==
      player.voiceChannelId
  ) {
    return interaction.reply({
      content:
        "🎤 Join my voice channel first da!",
      ephemeral: true
    });
  }

  const state =
    getMusicState(
      interaction.guildId
    );

  try {

    // ==================================================
    // PAUSE / RESUME
    // ==================================================

    if (
      interaction.customId ===
      "music_pause"
    ) {

      await interaction.deferUpdate();

      const timer =
        getTimerState(
          interaction.guildId
        );

      // =================================================
      // PAUSE
      // =================================================

      if (!player.paused) {

        /*
         * Capture position BEFORE
         * pausing Lavalink.
         */

        const position =
          getDisplayPosition(
            player
          );

        /*
         * Use lavalink-client's
         * pause() method.
         */

        await player.pause();

        /*
         * Freeze our timer.
         */

        timer.basePosition =
          position;

        timer.startedAt =
          Date.now();

        await updateMusicUI(
          player,
          position
        );

        return;
      }

      // =================================================
      // RESUME
      // =================================================

      /*
       * lavalink-client provides
       * resume() directly.
       */

      await player.resume();

      /*
       * Give Lavalink a moment to
       * update its position.
       */

      const position =
        Number(
          player.position ||
          timer.basePosition ||
          0
        );

      timer.basePosition =
        position;

      timer.startedAt =
        Date.now();

      await updateMusicUI(
        player,
        position
      );

      startMusicTimer(
        player
      );

      return;
    }

    // ==================================================
    // SKIP
    // ==================================================

    if (
      interaction.customId ===
      "music_skip"
    ) {

      await interaction.deferUpdate();

      await player.skip();

      return;
    }

    // ==================================================
    // PREVIOUS
    // ==================================================

    if (
      interaction.customId ===
      "music_previous"
    ) {

      await interaction.deferUpdate();

      if (
        typeof player.playPrevious ===
        "function"
      ) {
        await player.playPrevious();
      } else if (
        typeof player.queue.previous ===
        "function"
      ) {
        await player.queue.previous();
      }

      return;
    }

    // ==================================================
    // STOP
    // ==================================================

    if (
      interaction.customId ===
      "music_stop"
    ) {

      await interaction.deferUpdate();

      stopMusicTimer(
        interaction.guildId
      );

      await player.destroy();

      const data =
        musicMessages.get(
          interaction.guildId
        );

      musicMessages.delete(
        interaction.guildId
      );

      if (data) {

        try {

          await data.message.edit({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  "#ED4245"
                )
                .setTitle(
                  "⏹️ MUSIC STOPPED"
                )
                .setDescription(
                  "Music stopped.\n\n👋 See you next time!"
                )
            ],

            components: []
          });

        } catch {}
      }

      return;
    }

    // ==================================================
    // REFRESH
    // ==================================================

    if (
      interaction.customId ===
      "music_refresh"
    ) {

      await interaction.deferUpdate();

      /*
       * IMPORTANT:
       *
       * Refresh must NOT reset
       * the timer.
       */

      const position =
        getDisplayPosition(
          player
        );

      await updateMusicUI(
        player,
        position
      );

      startMusicTimer(
        player
      );

      return;
    }

    // ==================================================
    // VOLUME DOWN
    // ==================================================

    if (
      interaction.customId ===
      "music_volume_down"
    ) {

      await interaction.deferUpdate();

      state.volume =
        Math.max(
          0,
          state.volume - 10
        );

      await player.setVolume(
        state.volume
      );

      const position =
        getDisplayPosition(
          player
        );

      await updateMusicUI(
        player,
        position
      );

      return;
    }

    // ==================================================
    // VOLUME UP
    // ==================================================

    if (
      interaction.customId ===
      "music_volume_up"
    ) {

      await interaction.deferUpdate();

      state.volume =
        Math.min(
          150,
          state.volume + 10
        );

      await player.setVolume(
        state.volume
      );

      const position =
        getDisplayPosition(
          player
        );

      await updateMusicUI(
        player,
        position
      );

      return;
    }

    // ==================================================
    // SHUFFLE
    // ==================================================

    if (
      interaction.customId ===
      "music_shuffle"
    ) {

      const success =
        shuffleQueue(
          player
        );

      if (!success) {
        return interaction.reply({
          content:
            "🔀 Need at least 2 songs in queue.",
          ephemeral: true
        });
      }

      await interaction.deferUpdate();

      state.shuffle =
        !state.shuffle;

      const position =
        getDisplayPosition(
          player
        );

      await updateMusicUI(
        player,
        position
      );

      return;
    }

    // ==================================================
    // LOOP
    // ==================================================

    if (
      interaction.customId ===
      "music_loop"
    ) {

      await interaction.deferUpdate();

      state.loop =
        !state.loop;

      const position =
        getDisplayPosition(
          player
        );

      await updateMusicUI(
        player,
        position
      );

      return;
    }

    // ==================================================
    // QUEUE
    // ==================================================

    if (
      interaction.customId ===
      "music_queue"
    ) {

      await interaction.deferUpdate();

      await interaction.followUp({
        embeds: [
          createQueueEmbed(
            player
          )
        ],
        ephemeral: true
      });

      return;
    }

  } catch (error) {

    console.error(
      "❌ BUTTON ERROR:",
      error
    );

    if (
      !interaction.replied &&
      !interaction.deferred
    ) {
      return interaction.reply({
        content:
          "❌ Something went wrong.",
        ephemeral: true
      });
    }
  }
}

// ======================================================
// TRACK START
// ======================================================

client.lavalink.on(
  "trackStart",
  async (
    player,
    track
  ) => {

    console.log(
      `▶️ Now playing: ${track.info.title}`
    );

    const timer =
      getTimerState(
        player.guildId
      );

    /*
     * NEW TRACK
     */

    timer.basePosition = 0;

    timer.startedAt =
      Date.now();

    timer.trackIdentifier =
      track.info.identifier ||
      track.info.uri ||
      null;

    await updateMusicUI(
      player,
      0
    );

    startMusicTimer(
      player
    );
  }
);

// ======================================================
// TRACK END
// ======================================================

client.lavalink.on(
  "trackEnd",
  async player => {

    console.log(
      `⏭️ Track ended: ${player.guildId}`
    );
  }
);

// ======================================================
// TRACK ERROR
// ======================================================

client.lavalink.on(
  "trackError",
  async (
    player,
    track,
    payload
  ) => {

    console.error(
      "❌ Track error:",
      payload
    );

    const channel =
      client.channels.cache.get(
        player.textChannelId
      );

    if (channel) {
      await channel.send(
        `❌ Couldn't play **${track?.info?.title || "this track"}**.`
      );
    }
  }
);

// ======================================================
// QUEUE END
// ======================================================

client.lavalink.on(
  "queueEnd",
  async player => {

    console.log(
      `📋 Queue ended: ${player.guildId}`
    );

    stopMusicTimer(
      player.guildId
    );

    await updateMusicUI(
      player
    );
  }
);

// ======================================================
// PLAYER DESTROY
// ======================================================

client.lavalink.on(
  "playerDestroy",
  player => {

    stopMusicTimer(
      player.guildId
    );
  }
);

// ======================================================
// WELCOME
// ======================================================

client.on(
  "guildMemberAdd",
  async member => {

    const channel =
      member.guild.channels.cache.find(
        channel =>
          channel.name ===
          "general"
      );

    if (!channel) {
      return;
    }

    const embed =
      new EmbedBuilder()

        .setColor(
          "#5865F2"
        )

        .setTitle(
          "Ada 😯"
        )

        .setDescription(
          `Vaa sivaji nee varuva nu **${member.guild.name}** ku theriyum 😎, ${member}!`
        )

        .setThumbnail(
          member.user.displayAvatarURL({
            dynamic: true,
            size: 256
          })
        )

        .setFooter({
          text:
            `Indha token uh 🪙 #${member.guild.memberCount}`
        });

    await channel.send({
      embeds: [
        embed
      ]
    });
  }
);

// ======================================================
// LEAVE
// ======================================================

client.on(
  "guildMemberRemove",
  async member => {

    const channel =
      member.guild.channels.cache.find(
        channel =>
          channel.name ===
          "general"
      );

    if (!channel) {
      return;
    }

    const embed =
      new EmbedBuilder()

        .setColor(
          "#5865F2"
        )

        .setTitle(
          "Eey"
        )

        .setDescription(
          `${member} enga da kelambita`
        )

        .setThumbnail(
          member.user.displayAvatarURL({
            dynamic: true,
            size: 256
          })
        )

        .setFooter({
          text:
            "Solla maathiya"
        });

    await channel.send({
      embeds: [
        embed
      ]
    });
  }
);

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [

  new SlashCommandBuilder()
    .setName("play")
    .setDescription(
      "Play YouTube music"
    )
    .addStringOption(
      option =>
        option
          .setName("song")
          .setDescription(
            "YouTube song, URL or playlist"
          )
          .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription(
      "Skip current song"
    ),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription(
      "Pause music"
    ),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription(
      "Resume music"
    ),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription(
      "Stop music"
    ),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription(
      "Show music queue"
    ),

  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription(
      "Show music player"
    ),

  new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription(
      "Shuffle queue"
    ),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription(
      "Check bot latency"
    ),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Show bot statistics"
    )

].map(
  command =>
    command.toJSON()
  );

// ======================================================
// REGISTER COMMANDS
// ======================================================

async function registerCommands() {

  const rest =
    new REST({
      version: "10"
    }).setToken(
      TOKEN
    );

  try {

    console.log(
      "🔄 Registering slash commands..."
    );

    await rest.put(
      Routes.applicationCommands(
        CLIENT_ID
      ),
      {
        body: commands
      }
    );

    console.log(
      "✅ Slash commands registered"
    );

  } catch (error) {

    console.error(
      "❌ Command registration failed:"
    );

    console.error(error);
  }
}

registerCommands();

// ======================================================
// INTERACTION CREATE
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {

    // ==================================================
    // BUTTON
    // ==================================================

    if (
      interaction.isButton()
    ) {
      return handleButton(
        interaction
      );
    }

    // ==================================================
    // SLASH COMMAND
    // ==================================================

    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    // ==================================================
    // PLAY
    // ==================================================

    if (
      interaction.commandName ===
      "play"
    ) {
      return handlePlay(
        interaction
      );
    }

    // ==================================================
    // SKIP
    // ==================================================

    if (
      interaction.commandName ===
      "skip"
    ) {

      const player =
        client.lavalink.players.get(
          interaction.guildId
        );

      if (!player) {
        return interaction.reply(
          "❌ Nothing is playing."
        );
      }

      await player.skip();

      return interaction.reply(
        "⏭️ Skipped!"
      );
    }

    // ==================================================
    // PAUSE
    // ==================================================

    if (
      interaction.commandName ===
      "pause"
    ) {

      const player =
        client.lavalink.players.get(
          interaction.guildId
        );

      if (!player) {
        return interaction.reply(
          "❌ Nothing is playing."
        );
      }

      if (player.paused) {
        return interaction.reply(
          "⏸️ Already paused!"
        );
      }

      const position =
        getDisplayPosition(
          player
        );

      await player.pause();

      const timer =
        getTimerState(
          interaction.guildId
        );

      timer.basePosition =
        position;

      timer.startedAt =
        Date.now();

      await updateMusicUI(
        player,
        position
      );

      return interaction.reply(
        "⏸️ Paused!"
      );
    }

    // ==================================================
    // RESUME
    // ==================================================

    if (
      interaction.commandName ===
      "resume"
    ) {

      const player =
        client.lavalink.players.get(
          interaction.guildId
        );

      if (!player) {
        return interaction.reply(
          "❌ Nothing is playing."
        );
      }

      if (!player.paused) {
        return interaction.reply(
          "▶️ Already playing!"
        );
      }

      await player.resume();

      const timer =
        getTimerState(
          interaction.guildId
        );

      const position =
        Number(
          player.position ||
          timer.basePosition ||
          0
        );

      timer.basePosition =
        position;

      timer.startedAt =
        Date.now();

      await updateMusicUI(
        player,
        position
      );

      startMusicTimer(
        player
      );

      return interaction.reply(
        "▶️ Resumed!"
      );
    }

    // ==================================================
    // STOP
    // ==================================================

    if (
      interaction.commandName ===
      "stop"
    ) {

      const player =
        client.lavalink.players.get(
          interaction.guildId
        );

      if (!player) {
        return interaction.reply(
          "❌ Nothing is playing."
        );
      }

      stopMusicTimer(
        interaction.guildId
      );

      await player.destroy();

      const data =
        musicMessages.get(
          interaction.guildId
        );

      musicMessages.delete(
        interaction.guildId
      );

      if (data) {

        try {

          await data.message.edit({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  "#ED4245"
                )
                .setTitle(
                  "⏹️ MUSIC STOPPED"
                )
                .setDescription(
                  "Music stopped.\n\n👋 See you next time!"
                )
            ],
            components: []
          });

        } catch {}
      }

      return interaction.reply(
        "⏹️ Music stopped!"
      );
    }

    // ==================================================
    // QUEUE
    // ==================================================

    if (
      interaction.commandName ===
      "queue"
    ) {

      const player =
        client.lavalink.players.get(
          interaction.guildId
        );

      if (!player) {
        return interaction.reply(
          "📋 Queue is empty!"
        );
      }

      return interaction.reply({
        embeds: [
          createQueueEmbed(
            player
          )
        ]
      });
    }

    // ==================================================
    // NOW PLAYING
    // ==================================================

    if (
      interaction.commandName ===
      "nowplaying"
    ) {

      const player =
        client.lavalink.players.get(
          interaction.guildId
        );

      if (!player) {
        return interaction.reply({
          content:
            "❌ Nothing is playing.",
          ephemeral: true
        });
      }

      await createMusicUI(
        interaction,
        player
      );

      return interaction.reply({
        content:
          "🎵 Music Player refreshed!",
        ephemeral: true
      });
    }

    // ==================================================
    // SHUFFLE
    // ==================================================

    if (
      interaction.commandName ===
      "shuffle"
    ) {

      const player =
        client.lavalink.players.get(
          interaction.guildId
        );

      if (!player) {
        return interaction.reply(
          "📋 Queue is empty!"
        );
      }

      const success =
        shuffleQueue(
          player
        );

      if (!success) {
        return interaction.reply(
          "🔀 Need at least 2 songs in queue!"
        );
      }

      getMusicState(
        interaction.guildId
      ).shuffle = true;

      const position =
        getDisplayPosition(
          player
        );

      await updateMusicUI(
        player,
        position
      );

      return interaction.reply(
        "🔀 Queue shuffled! 🎉"
      );
    }

    // ==================================================
    // PING
    // ==================================================

    if (
      interaction.commandName ===
      "ping"
    ) {

      const start =
        Date.now();

      await interaction.deferReply();

      const response =
        Date.now() -
        start;

      const embed =
        new EmbedBuilder()
          .setColor(
            "#57F287"
          )

          .setTitle(
            "🏓 PONG!"
          )

          .addFields(

            {
              name:
                "🤖 Discord API",

              value:
                `\`${response} ms\``,

              inline: true
            },

            {
              name:
                "🌐 WebSocket",

              value:
                `\`${client.ws.ping} ms\``,

              inline: true
            }

          )

          .setFooter({
            text:
              "YouTube Music Bot"
          })

          .setTimestamp();

      return interaction.editReply({
        embeds: [
          embed
        ]
      });
    }

    // ==================================================
    // STATS
    // ==================================================

    if (
      interaction.commandName ===
      "stats"
    ) {

      const uptime =
        process.uptime();

      const days =
        Math.floor(
          uptime / 86400
        );

      const hours =
        Math.floor(
          (uptime % 86400) /
          3600
        );

      const minutes =
        Math.floor(
          (uptime % 3600) /
          60
        );

      const seconds =
        Math.floor(
          uptime % 60
        );

      const memory =
        process.memoryUsage();

      const memoryMB =
        (
          memory.rss /
          1024 /
          1024
        ).toFixed(1);

      const guilds =
        client.guilds.cache.size;

      const users =
        client.guilds.cache.reduce(
          (
            total,
            guild
          ) =>
            total +
            guild.memberCount,
          0
        );

      const players =
        client.lavalink.players.size;

      const embed =
        new EmbedBuilder()

          .setColor(
            "#5865F2"
          )

          .setTitle(
            "🤖 BOT STATISTICS"
          )

          .setDescription(
            "✨ Everything is running!"
          )

          .addFields(

            {
              name:
                "🏠 Servers",

              value:
                `\`${guilds}\``,

              inline: true
            },

            {
              name:
                "👥 Users",

              value:
                `\`${users}\``,

              inline: true
            },

            {
              name:
                "🎵 Music Players",

              value:
                `\`${players}\``,

              inline: true
            },

            {
              name:
                "💾 Memory",

              value:
                `${memoryMB} MB`,

              inline: true
            },

            {
              name:
                "⏱️ Uptime",

              value:
                `${days}d ${hours}h ${minutes}m ${seconds}s`,

              inline: true
            },

            {
              name:
                "📡 WebSocket",

              value:
                `\`${client.ws.ping} ms\``,

              inline: true
            },

            {
              name:
                "⚙️ Node.js",

              value:
                `\`${process.version}\``,

              inline: true
            },

            {
              name:
                "🎧 Source",

              value:
                "`YouTube`",

              inline: true
            }

          )

          .setFooter({
            text:
              `Logged in as ${client.user.tag}`
          })

          .setTimestamp();

      return interaction.reply({
        embeds: [
          embed
        ]
      });
    }
  }
);

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);

process.on('exit', (code) => {
    console.log(`⚠️ Node process exiting with code: ${code}`);
});

process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM received');
});

process.on('SIGINT', () => {
    console.log('⚠️ SIGINT received');
});

process.on('uncaughtException', (error) => {
    console.error('❌ UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ UNHANDLED REJECTION:', error);
});
