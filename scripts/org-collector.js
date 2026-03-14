const axios = require("axios")

const ORG = "Altair-Linux"

const LOGO =
  "https://raw.githubusercontent.com/Altair-Linux/altair-branding/refs/heads/main/logos/altair-logo-monochrome.svg"

const headers = {
  Authorization: `token ${process.env.ORG_GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json"
}

const COLORS = {
  release: 5814783,
  commit: 10070709,
  pr: 16761035,
  issue: 15548997,
  ci: 5793266
}

async function sendDiscord(webhook, username, embed) {
  if (!webhook) return

  await axios.post(webhook, {
    username,
    avatar_url: LOGO,
    allowed_mentions: { parse: [] },
    embeds: [embed]
  })
}

function baseEmbed(title, url, color) {
  return {
    title,
    url,
    color,
    thumbnail: { url: LOGO },
    timestamp: new Date().toISOString(),
    footer: {
      text: "Altair Linux • GitHub Activity"
    }
  }
}

async function getRepos() {
  let repos = []
  let page = 1

  while (true) {
    const res = await axios.get(
      `https://api.github.com/orgs/${ORG}/repos?per_page=100&page=${page}`,
      { headers }
    )

    repos = repos.concat(res.data)

    if (res.data.length < 100) break
    page++
  }

  return repos
}

async function handleReleases(repo) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repo.full_name}/releases/latest`,
      { headers }
    )

    const r = res.data

    const embed = baseEmbed(
      `Release ${r.tag_name}`,
      r.html_url,
      COLORS.release
    )

    embed.fields = [
      { name: "Repository", value: repo.name, inline: true },
      { name: "Version", value: r.tag_name, inline: true },
      { name: "Author", value: r.author?.login || "unknown", inline: true }
    ]

    embed.description = r.name || "New release published"

    await sendDiscord(
      process.env.DISCORD_WEBHOOK_RELEASE,
      "altair release daemon",
      embed
    )
  } catch {}
}

async function handleCommits(repo) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repo.full_name}/commits?sha=${repo.default_branch}&per_page=3`,
      { headers }
    )

    for (const commit of res.data) {
      const embed = baseEmbed(
        "New Commit",
        commit.html_url,
        COLORS.commit
      )

      embed.fields = [
        { name: "Repository", value: repo.name, inline: true },
        { name: "Branch", value: repo.default_branch, inline: true },
        {
          name: "Author",
          value: commit.commit.author.name,
          inline: true
        }
      ]

      embed.description = commit.commit.message.split("\n")[0]

      await sendDiscord(
        process.env.DISCORD_WEBHOOK_KERNEL_COMMITS,
        "altair commit daemon",
        embed
      )
    }
  } catch {}
}

async function handlePRs(repo) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repo.full_name}/pulls?state=open&per_page=3`,
      { headers }
    )

    for (const pr of res.data) {
      const embed = baseEmbed(
        `Pull Request #${pr.number}`,
        pr.html_url,
        COLORS.pr
      )

      embed.fields = [
        { name: "Repository", value: repo.name, inline: true },
        {
          name: "Branch",
          value: `${pr.head.ref} → ${pr.base.ref}`,
          inline: true
        },
        { name: "Author", value: pr.user.login, inline: true }
      ]

      embed.description = pr.title

      await sendDiscord(
        process.env.DISCORD_WEBHOOK_KERNEL_PR,
        "altair review daemon",
        embed
      )
    }
  } catch {}
}

async function handleIssues(repo) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repo.full_name}/issues?state=open&per_page=3`,
      { headers }
    )

    for (const issue of res.data.filter(i => !i.pull_request)) {
      const embed = baseEmbed(
        `Issue #${issue.number}`,
        issue.html_url,
        COLORS.issue
      )

      embed.fields = [
        { name: "Repository", value: repo.name, inline: true },
        { name: "Author", value: issue.user.login, inline: true }
      ]

      embed.description = issue.title

      await sendDiscord(
        process.env.DISCORD_WEBHOOK_KERNEL_ISSUES,
        "altair issue daemon",
        embed
      )
    }
  } catch {}
}

async function handleCI(repo) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repo.full_name}/actions/runs?per_page=2`,
      { headers }
    )

    for (const run of res.data.workflow_runs) {
      const embed = baseEmbed(
        `CI Workflow ${run.conclusion || run.status}`,
        run.html_url,
        COLORS.ci
      )

      embed.fields = [
        { name: "Repository", value: repo.name, inline: true },
        { name: "Workflow", value: run.name, inline: true },
        { name: "Actor", value: run.actor.login, inline: true }
      ]

      await sendDiscord(
        process.env.DISCORD_WEBHOOK_CI,
        "altair ci daemon",
        embed
      )
    }
  } catch {}
}

async function main() {
  const repos = await getRepos()

  for (const repo of repos) {
    await handleReleases(repo)
    await handleCommits(repo)
    await handlePRs(repo)
    await handleIssues(repo)
    await handleCI(repo)
  }
}

main()
