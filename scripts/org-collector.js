/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Altair-Linux Organisation Webhook Collector
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Monitors every repository in the Altair-Linux GitHub organisation and posts
 * rich Discord embeds for the following event types:
 *
 *   • Commits   (green)    – pushed to any branch
 *   • Pull Requests (orange) – opened, reopened, synchronised, closed
 *   • Issues    (yellow)   – opened, reopened, closed, edited
 *   • Releases  (red)      – published
 *   • Workflow / CI (blue / red) – completed workflow runs
 *   • Branches & Tags (purple) – created or deleted via create / delete events
 *
 * Environment variables (set via GitHub Actions secrets):
 *   ORG_GITHUB_TOKEN        – Personal access token with org:read scope
 *   DISCORD_WEBHOOK_COMMITS – Webhook URL for commit messages
 *   DISCORD_WEBHOOK_PR      – Webhook URL for pull request messages
 *   DISCORD_WEBHOOK_ISSUES  – Webhook URL for issue messages
 *   DISCORD_WEBHOOK_RELEASE – Webhook URL for release messages
 *   DISCORD_WEBHOOK_CI      – Webhook URL for CI / workflow run messages
 *   GITHUB_EVENT_NAME       – (automatic) The event that triggered the workflow
 *   GITHUB_EVENT_PATH       – (automatic) Path to the event payload JSON
 *
 * @module org-collector
 */

const axios = require("axios");
const fs = require("fs");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Altair-Linux branding logo used as the embed thumbnail and bot avatar. */
const LOGO =
  "https://media.discordapp.net/attachments/1481906393085906975/1482315760188657714/altair-logo-monochrome.png?ex=69b681a1&is=69b53021&hm=8532ede0d3fb2cd07e6feeb36c6e111aef0187b70569156bbc1b7da9a4ca8d5f&=&format=webp&quality=lossless&width=943&height=943";

/** GitHub organisation name to monitor. */
const ORG_NAME = "Altair-Linux";

/** Colour palette for Discord embeds (decimal representation). */
const COLORS = {
  COMMIT:          0x2ecc71, // green
  PULL_REQUEST:    0xe67e22, // orange
  ISSUE:           0xf1c40f, // yellow
  RELEASE:         0xe74c3c, // red
  CI_SUCCESS:      0x3498db, // blue
  CI_FAILURE:      0xe74c3c, // red
  BRANCH_TAG:      0x9b59b6, // purple
};

/** Default HTTP headers for authenticated GitHub API requests. */
const GITHUB_HEADERS = {
  Authorization: `token ${process.env.ORG_GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
};

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a single Discord embed to the specified webhook URL.
 *
 * @param {string} webhookUrl  – Discord webhook endpoint
 * @param {object} embed       – Discord embed object
 * @param {string} botUsername – Display name for the webhook bot
 */
async function sendDiscord(webhookUrl, embed, botUsername) {
  if (!webhookUrl) {
    console.warn(`[SKIP] No webhook URL provided for embed "${embed.title}".`);
    return;
  }

  try {
    await axios.post(webhookUrl, {
      username: botUsername,
      avatar_url: LOGO,
      embeds: [embed],
    });
    console.log(`[SENT] ${botUsername}: ${embed.title}`);
  } catch (err) {
    console.error(
      `[ERROR] Failed to send Discord message "${embed.title}":`,
      err.response?.data || err.message
    );
  }
}

/**
 * Creates a standardised embed footer for every message.
 *
 * @param {string} repoName – Short repository name (e.g. "altair-iso")
 * @returns {object} Footer object with text and icon_url
 */
function makeFooter(repoName) {
  return {
    text: `Altair Linux - ${repoName}`,
    icon_url: LOGO,
  };
}

/**
 * Fetches all repositories belonging to the Altair-Linux org with pagination.
 *
 * @returns {Promise<Array>} Array of repository objects from the GitHub API
 */
async function getRepos() {
  console.log(`[INFO] Fetching all repositories for organisation "${ORG_NAME}"...`);

  let repos = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/orgs/${ORG_NAME}/repos?per_page=100&page=${page}`;
    console.log(`[INFO]   ↳ Fetching repos page ${page}...`);

    const res = await axios.get(url, { headers: GITHUB_HEADERS });
    repos = repos.concat(res.data);

    if (res.data.length < 100) break;
    page++;
  }

  console.log(`[INFO] Found ${repos.length} repositories in "${ORG_NAME}".`);
  return repos;
}

/**
 * Reads and parses the GitHub Actions event payload from GITHUB_EVENT_PATH.
 *
 * @returns {object|null} Parsed event payload or null if unavailable
 */
function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;

  try {
    const raw = fs.readFileSync(eventPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[WARN] Could not read event payload:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event handlers – each function processes one event type for one repository
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches and posts the latest release for a repository.
 *
 * @param {string} fullName – "org/repo" identifier
 * @param {string} name     – Short repo name
 */
async function processReleases(fullName, name) {
  console.log(`[INFO] [${fullName}] Checking for latest release...`);

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${fullName}/releases/latest`,
      { headers: GITHUB_HEADERS }
    );
    const r = res.data;

    if (!r || !r.tag_name) {
      console.log(`[INFO] [${fullName}] No releases found.`);
      return;
    }

    console.log(`[INFO] [${fullName}] Found release: ${r.tag_name}`);

    await sendDiscord(process.env.DISCORD_WEBHOOK_RELEASE, {
      title: `🚀 Release **${r.tag_name}** in ${fullName}`,
      url: r.html_url,
      description:
        `**${r.name || "Unnamed release"}**\n` +
        `${r.body ? (r.body.length > 1800 ? r.body.substring(0, 1800) + "…" : r.body) : "_No release notes provided._"}`,
      color: COLORS.RELEASE,
      thumbnail: { url: LOGO },
      fields: [
        { name: "📦 Repository",  value: fullName,         inline: true },
        { name: "👤 Author",      value: r.author?.login || "Unknown", inline: true },
        { name: "🏷️ Tag",         value: r.tag_name,       inline: true },
        { name: "📅 Created At",  value: r.created_at,     inline: true },
        { name: "🔖 Pre-release", value: r.prerelease ? "Yes" : "No", inline: true },
      ],
      footer: makeFooter(name),
    }, "Altair Release Daemon");
  } catch (err) {
    // A 404 simply means no releases exist for this repo – that is normal
    if (err.response?.status === 404) {
      console.log(`[INFO] [${fullName}] No releases found (404).`);
    } else {
      console.error(`[ERROR] [${fullName}] Failed to fetch releases:`, err.message);
    }
  }
}

/**
 * Fetches and posts recent commits on the default branch.
 * Uses pagination to fetch up to 30 commits per repository.
 *
 * @param {string} fullName      – "org/repo" identifier
 * @param {string} name          – Short repo name
 * @param {string} defaultBranch – Default branch name (e.g. "main")
 */
async function processCommits(fullName, name, defaultBranch) {
  console.log(`[INFO] [${fullName}] Fetching recent commits on branch "${defaultBranch}"...`);

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${fullName}/commits?sha=${defaultBranch}&per_page=10`,
      { headers: GITHUB_HEADERS }
    );

    console.log(`[INFO] [${fullName}] Found ${res.data.length} commits to process.`);

    for (const commit of res.data) {
      const sha = commit.sha;
      const shortSha = sha.substring(0, 7);
      const message = commit.commit.message;
      const authorName = commit.commit.author?.name || "Unknown";
      const authorDate = commit.commit.author?.date || "Unknown";

      await sendDiscord(process.env.DISCORD_WEBHOOK_COMMITS, {
        title: `📝 Commit \`${shortSha}\` in ${fullName}`,
        url: commit.html_url,
        description:
          `**Message:** ${message.length > 1000 ? message.substring(0, 1000) + "…" : message}\n\n` +
          `*Branch:* \`${defaultBranch}\``,
        color: COLORS.COMMIT,
        thumbnail: { url: LOGO },
        fields: [
          { name: "📦 Repository",  value: fullName,      inline: true },
          { name: "👤 Author",      value: authorName,    inline: true },
          { name: "🔀 Branch",      value: defaultBranch, inline: true },
          { name: "🔑 Commit SHA",  value: `\`${sha}\``,  inline: false },
          { name: "📅 Date",        value: authorDate,    inline: true },
        ],
        footer: makeFooter(name),
      }, "Altair Commit Daemon");
    }
  } catch (err) {
    console.error(`[ERROR] [${fullName}] Failed to fetch commits:`, err.message);
  }
}

/**
 * Fetches and posts all open pull requests for a repository.
 *
 * @param {string} fullName – "org/repo" identifier
 * @param {string} name     – Short repo name
 */
async function processPullRequests(fullName, name) {
  console.log(`[INFO] [${fullName}] Fetching open pull requests...`);

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${fullName}/pulls?state=open&per_page=100`,
      { headers: GITHUB_HEADERS }
    );

    console.log(`[INFO] [${fullName}] Found ${res.data.length} open pull requests.`);

    for (const pr of res.data) {
      const labels = pr.labels.map((l) => l.name).join(", ") || "None";
      const milestone = pr.milestone?.title || "None";

      await sendDiscord(process.env.DISCORD_WEBHOOK_PR, {
        title: `🔃 PR #${pr.number} in ${fullName}`,
        url: pr.html_url,
        description:
          `**${pr.title}**\n\n` +
          `*${pr.body ? (pr.body.length > 800 ? pr.body.substring(0, 800) + "…" : pr.body) : "No description provided."}*`,
        color: COLORS.PULL_REQUEST,
        thumbnail: { url: LOGO },
        fields: [
          { name: "📦 Repository",   value: fullName,            inline: true },
          { name: "👤 Author",       value: pr.user?.login || "Unknown", inline: true },
          { name: "📊 State",        value: pr.state,            inline: true },
          { name: "🔀 Head Branch",  value: pr.head?.ref || "N/A", inline: true },
          { name: "🎯 Base Branch",  value: pr.base?.ref || "N/A", inline: true },
          { name: "📅 Created At",   value: pr.created_at,       inline: true },
          { name: "🏷️ Labels",       value: labels,              inline: true },
          { name: "🗓️ Milestone",    value: milestone,           inline: true },
        ],
        footer: makeFooter(name),
      }, "Altair PR Daemon");
    }
  } catch (err) {
    console.error(`[ERROR] [${fullName}] Failed to fetch pull requests:`, err.message);
  }
}

/**
 * Fetches and posts all open issues (excluding pull requests) for a repository.
 *
 * @param {string} fullName – "org/repo" identifier
 * @param {string} name     – Short repo name
 */
async function processIssues(fullName, name) {
  console.log(`[INFO] [${fullName}] Fetching open issues...`);

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${fullName}/issues?state=open&per_page=100`,
      { headers: GITHUB_HEADERS }
    );

    // The GitHub Issues API also returns pull requests; filter them out
    const issues = res.data.filter((i) => !i.pull_request);

    console.log(`[INFO] [${fullName}] Found ${issues.length} open issues (PRs excluded).`);

    for (const issue of issues) {
      const labels = issue.labels.map((l) => l.name).join(", ") || "None";
      const milestone = issue.milestone?.title || "None";

      await sendDiscord(process.env.DISCORD_WEBHOOK_ISSUES, {
        title: `🐛 Issue #${issue.number} in ${fullName}`,
        url: issue.html_url,
        description:
          `**${issue.title}**\n\n` +
          `*${issue.body ? (issue.body.length > 800 ? issue.body.substring(0, 800) + "…" : issue.body) : "No description provided."}*`,
        color: COLORS.ISSUE,
        thumbnail: { url: LOGO },
        fields: [
          { name: "📦 Repository",   value: fullName,                     inline: true },
          { name: "👤 Author",       value: issue.user?.login || "Unknown", inline: true },
          { name: "📊 State",        value: issue.state,                  inline: true },
          { name: "📅 Created At",   value: issue.created_at,             inline: true },
          { name: "🏷️ Labels",       value: labels,                       inline: true },
          { name: "🗓️ Milestone",    value: milestone,                    inline: true },
        ],
        footer: makeFooter(name),
      }, "Altair Issue Daemon");
    }
  } catch (err) {
    console.error(`[ERROR] [${fullName}] Failed to fetch issues:`, err.message);
  }
}

/**
 * Fetches and posts recent workflow runs (CI) for a repository.
 * Colour is blue for successful runs and red for failures.
 *
 * @param {string} fullName – "org/repo" identifier
 * @param {string} name     – Short repo name
 */
async function processWorkflowRuns(fullName, name) {
  console.log(`[INFO] [${fullName}] Fetching recent workflow runs...`);

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${fullName}/actions/runs?per_page=5`,
      { headers: GITHUB_HEADERS }
    );

    const runs = res.data.workflow_runs || [];
    console.log(`[INFO] [${fullName}] Found ${runs.length} recent workflow runs.`);

    for (const run of runs) {
      const conclusion = run.conclusion || "in_progress";
      const isSuccess = conclusion === "success";

      await sendDiscord(process.env.DISCORD_WEBHOOK_CI, {
        title: `⚙️ Workflow **${run.name}** — ${conclusion.toUpperCase()}`,
        url: run.html_url,
        description:
          `*Triggered by* **${run.actor?.login || "Unknown"}** ` +
          `on event \`${run.event}\``,
        color: isSuccess ? COLORS.CI_SUCCESS : COLORS.CI_FAILURE,
        thumbnail: { url: LOGO },
        fields: [
          { name: "📦 Repository",  value: fullName,                  inline: true },
          { name: "👤 Actor",       value: run.actor?.login || "Unknown", inline: true },
          { name: "🔀 Branch",      value: run.head_branch || "N/A", inline: true },
          { name: "🏁 Conclusion",  value: conclusion,               inline: true },
          { name: "🔢 Run Number",  value: String(run.run_number),   inline: true },
          { name: "📅 Updated At",  value: run.updated_at || "N/A",  inline: true },
        ],
        footer: makeFooter(name),
      }, "Altair CI Daemon");
    }
  } catch (err) {
    console.error(`[ERROR] [${fullName}] Failed to fetch workflow runs:`, err.message);
  }
}

/**
 * Posts a Discord message when a branch or tag is created or deleted.
 * This is driven by the GitHub Actions `create` / `delete` event payload.
 *
 * @param {object} payload   – GitHub event payload
 * @param {string} eventName – "create" or "delete"
 */
async function processBranchTagEvent(payload, eventName) {
  if (!payload || !payload.repository) return;

  const repo = payload.repository;
  const refType = payload.ref_type || "unknown"; // "branch" or "tag"
  const refName = payload.ref || "unknown";
  const action = eventName === "create" ? "Created" : "Deleted";
  const emoji = eventName === "create" ? "🌱" : "🗑️";

  console.log(
    `[INFO] [${repo.full_name}] ${refType} ${action.toLowerCase()}: ${refName}`
  );

  await sendDiscord(process.env.DISCORD_WEBHOOK_CI, {
    title: `${emoji} ${refType.charAt(0).toUpperCase() + refType.slice(1)} ${action}: **${refName}**`,
    url: repo.html_url,
    description:
      `A ${refType} was **${action.toLowerCase()}** in **${repo.full_name}**.`,
    color: COLORS.BRANCH_TAG,
    thumbnail: { url: LOGO },
    fields: [
      { name: "📦 Repository", value: repo.full_name,             inline: true },
      { name: "🔖 Ref Type",   value: refType,                    inline: true },
      { name: "🔀 Ref Name",   value: refName,                    inline: true },
      { name: "👤 Sender",     value: payload.sender?.login || "Unknown", inline: true },
    ],
    footer: makeFooter(repo.name),
  }, "Altair Branch/Tag Daemon");
}

/**
 * Posts a Discord message for a push event using the event payload.
 * Includes details about every commit in the push.
 *
 * @param {object} payload – GitHub push event payload
 */
async function processPushEvent(payload) {
  if (!payload || !payload.repository) return;

  const repo = payload.repository;
  const branch = (payload.ref || "").replace("refs/heads/", "");
  const commits = payload.commits || [];
  const pusher = payload.pusher?.name || payload.sender?.login || "Unknown";

  console.log(
    `[INFO] [${repo.full_name}] Push event: ${commits.length} commit(s) to branch "${branch}".`
  );

  for (const commit of commits) {
    const shortSha = commit.id.substring(0, 7);

    await sendDiscord(process.env.DISCORD_WEBHOOK_COMMITS, {
      title: `📝 Commit \`${shortSha}\` pushed to ${repo.full_name}`,
      url: commit.url,
      description:
        `**Message:** ${commit.message.length > 1000 ? commit.message.substring(0, 1000) + "…" : commit.message}\n\n` +
        `*Branch:* \`${branch}\` | *Pusher:* **${pusher}**`,
      color: COLORS.COMMIT,
      thumbnail: { url: LOGO },
      fields: [
        { name: "📦 Repository",  value: repo.full_name,                inline: true },
        { name: "👤 Author",      value: commit.author?.name || "Unknown", inline: true },
        { name: "🔀 Branch",      value: branch,                        inline: true },
        { name: "🔑 Commit SHA",  value: `\`${commit.id}\``,             inline: false },
        { name: "📅 Timestamp",   value: commit.timestamp || "N/A",     inline: true },
      ],
      footer: makeFooter(repo.name),
    }, "Altair Commit Daemon");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main function – determines the triggering event and dispatches to the
 * appropriate handler(s).  When triggered by an event-specific webhook
 * (push, PR, issue, release, create, delete, workflow_run) only that event
 * type is processed.  For workflow_dispatch or unknown events the full
 * organisation scan is performed.
 */
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Altair-Linux Organisation Webhook Collector");
  console.log("═══════════════════════════════════════════════════════════════");

  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const payload = readEventPayload();

  console.log(`[INFO] Triggered by event: "${eventName || "manual/unknown"}"`);

  // ── Event-driven path ──────────────────────────────────────────────────
  // When running inside GitHub Actions with a known event, we process only
  // the specific event to avoid duplicate messages and reduce API usage.

  if (eventName === "push" && payload) {
    console.log("[INFO] Processing push event from payload...");
    await processPushEvent(payload);
    console.log("[DONE] Push event processing complete.");
    return;
  }

  if ((eventName === "create" || eventName === "delete") && payload) {
    console.log(`[INFO] Processing ${eventName} event from payload...`);
    await processBranchTagEvent(payload, eventName);
    console.log(`[DONE] ${eventName} event processing complete.`);
    return;
  }

  // ── Full organisation scan ─────────────────────────────────────────────
  // For workflow_dispatch, schedule, or any other trigger we perform a
  // comprehensive scan of every repo in the organisation.

  console.log("[INFO] Running full organisation scan...");
  const repos = await getRepos();

  for (const repo of repos) {
    const { name, full_name, default_branch } = repo;

    console.log(`\n[INFO] ──── Processing repository: ${full_name} ────`);

    // Process each event type sequentially for this repository
    await processReleases(full_name, name);
    await processCommits(full_name, name, default_branch);
    await processPullRequests(full_name, name);
    await processIssues(full_name, name);
    await processWorkflowRuns(full_name, name);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Collection complete.");
  console.log("═══════════════════════════════════════════════════════════════");
}

// Run the collector
main().catch((err) => {
  console.error("[FATAL] Unhandled error in main:", err);
  process.exit(1);
});
