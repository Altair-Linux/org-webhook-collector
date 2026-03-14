const axios = require("axios");

const LOGO = "https://raw.githubusercontent.com/Altair-Linux/altair-branding/refs/heads/main/logos/altair-logo-monochrome.svg";

const headers = {
  Authorization: `token ${process.env.ORG_GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json"
};

// Send Discord embed
async function sendDiscord(webhook, embed, username) {
  try {
    await axios.post(webhook, {
      username,
      avatar_url: LOGO,
      embeds: [embed]
    });
    console.log(`Sent: ${embed.title}`);
  } catch (err) {
    console.error("Discord error:", err.response?.data || err.message);
  }
}

// Get all repos in Altair-Linux org
async function getRepos() {
  let repos = [], page = 1;
  while (true) {
    const res = await axios.get(`https://api.github.com/orgs/Altair-Linux/repos?per_page=100&page=${page}`, { headers });
    repos = repos.concat(res.data);
    if (res.data.length < 100) break;
    page++;
  }
  return repos;
}

async function main() {
  const repos = await getRepos();

  for (const repo of repos) {
    const { name, full_name, default_branch } = repo;

    // --- Releases ---
    try {
      const releaseRes = await axios.get(`https://api.github.com/repos/${full_name}/releases/latest`, { headers });
      const r = releaseRes.data;
      if (r) {
        await sendDiscord(process.env.DISCORD_WEBHOOK_RELEASE, {
          title: `Release ${r.tag_name} in ${full_name}`,
          url: r.html_url,
          description: `${r.name || "No release name"}\n${r.body || ""}`,
          color: 16711680,
          fields: [
            { name: "Repo", value: full_name },
            { name: "Author", value: r.author.login },
            { name: "Created At", value: r.created_at }
          ],
          footer: { text: `Altair Linux - ${name}` }
        }, "Altair Release Daemon");
      }
    } catch(e){}

    // --- Commits ---
    try {
      const commitsRes = await axios.get(`https://api.github.com/repos/${full_name}/commits?sha=${default_branch}&per_page=10`, { headers });
      for (const commit of commitsRes.data) {
        await sendDiscord(process.env.DISCORD_WEBHOOK_KERNEL_COMMITS, {
          title: `Commit in ${full_name}`,
          url: commit.html_url,
          description: commit.commit.message,
          color: 65280,
          fields: [
            { name: "Author", value: commit.commit.author.name },
            { name: "Branch", value: default_branch },
            { name: "Date", value: commit.commit.author.date }
          ],
          footer: { text: `Altair Linux - ${name}` }
        }, "Altair Commit Daemon");
      }
    } catch(e){}

    // --- Pull Requests ---
    try {
      const prsRes = await axios.get(`https://api.github.com/repos/${full_name}/pulls?state=open`, { headers });
      for (const pr of prsRes.data) {
        await sendDiscord(process.env.DISCORD_WEBHOOK_KERNEL_PR, {
          title: `PR #${pr.number} in ${full_name}`,
          url: pr.html_url,
          description: pr.title,
          color: 16753920,
          fields: [
            { name: "Author", value: pr.user.login },
            { name: "Branch", value: pr.head.ref },
            { name: "Created At", value: pr.created_at },
            { name: "Labels", value: pr.labels.map(l => l.name).join(", ") || "None" },
            { name: "State", value: pr.state }
          ],
          footer: { text: `Altair Linux - ${name}` }
        }, "Altair PR Daemon");
      }
    } catch(e){}

    // --- Issues ---
    try {
      const issuesRes = await axios.get(`https://api.github.com/repos/${full_name}/issues?state=open`, { headers });
      for (const issue of issuesRes.data.filter(i => !i.pull_request)) {
        await sendDiscord(process.env.DISCORD_WEBHOOK_KERNEL_ISSUES, {
          title: `Issue #${issue.number} in ${full_name}`,
          url: issue.html_url,
          description: issue.title,
          color: 16776960,
          fields: [
            { name: "Author", value: issue.user.login },
            { name: "Created At", value: issue.created_at },
            { name: "Labels", value: issue.labels.map(l => l.name).join(", ") || "None" },
            { name: "Milestone", value: issue.milestone?.title || "None" },
            { name: "State", value: issue.state }
          ],
          footer: { text: `Altair Linux - ${name}` }
        }, "Altair Issue Daemon");
      }
    } catch(e){}

    // --- Workflow runs (CI) ---
    try {
      const runsRes = await axios.get(`https://api.github.com/repos/${full_name}/actions/runs?per_page=5`, { headers });
      for (const run of runsRes.data.workflow_runs) {
        await sendDiscord(process.env.DISCORD_WEBHOOK_CI, {
          title: `Workflow ${run.name} - ${run.conclusion}`,
          url: run.html_url,
          description: `Triggered by ${run.actor.login}`,
          color: run.conclusion === "success" ? 65280 : 16711680,
          fields: [
            { name: "Event", value: run.event },
            { name: "Branch", value: run.head_branch },
            { name: "Run Number", value: run.run_number.toString() }
          ],
          footer: { text: `Altair Linux - ${name}` }
        }, "Altair CI Daemon");
      }
    } catch(e){}
  }
}

main();
