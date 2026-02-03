/**
 * Claude Skills Extension
 *
 * Automatically loads all Claude Code skills from .claude/skills/ folder
 * and injects them into the system prompt.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface Skill {
  name: string;
  description?: string;
  content: string;
  path: string;
}

function parseFrontmatter(content: string): { data: Record<string, any>; content: string } {
  const frontmatterMatch = content.match(/^---\n(.*?)\n---\n(.*)$/s);
  if (!frontmatterMatch) {
    return { data: {}, content };
  }

  const frontmatterText = frontmatterMatch[1];
  const bodyContent = frontmatterMatch[2];
  const data: Record<string, any> = {};

  for (const line of frontmatterText.split('\n')) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      data[key.trim()] = value.trim();
    }
  }

  return { data, content: bodyContent };
}

function loadSkills(basePath: string): Skill[] {
  const skillsDir = path.join(basePath, ".claude", "skills");
  const skills: Skill[] = [];

  if (!fs.existsSync(skillsDir)) {
    return skills;
  }

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
        if (fs.existsSync(skillPath)) {
          try {
            const content = fs.readFileSync(skillPath, "utf-8");
            const { data, content: bodyContent } = parseFrontmatter(content);
            
            skills.push({
              name: data.name || entry.name,
              description: data.description,
              content: bodyContent.trim(),
              path: skillPath,
            });
          } catch (error) {
            console.warn(`Failed to load skill from ${skillPath}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.warn("Failed to read skills directory:", error);
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export default function claudeSkillsExtension(pi: ExtensionAPI) {
  let skills: Skill[] = [];
  let basePath = "";

  function refreshSkills(ctx: any): void {
    skills = loadSkills(basePath);
    
    if (ctx.hasUI && skills.length > 0) {
      ctx.ui.setStatus("claude-skills", `${skills.length} skills`);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    basePath = ctx.cwd;
    refreshSkills(ctx);
    
    if (ctx.hasUI && skills.length > 0) {
      ctx.ui.notify(`Loaded ${skills.length} Claude skills`, "info");
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (skills.length === 0) {
      return;
    }

    const skillsSection = skills
      .map(skill => {
        let section = `### ${skill.name}`;
        if (skill.description) {
          section += `\n*${skill.description}*`;
        }
        section += `\n\n${skill.content}`;
        return section;
      })
      .join('\n\n---\n\n');

    return {
      systemPrompt: event.systemPrompt + `

## Claude Code Skills

You have access to the following project-specific coding skills and best practices:

${skillsSection}

Apply these skills when working with this codebase. Use the patterns, conventions, and practices described above.
`,
    };
  });

  pi.registerCommand("skills", {
    description: "Refresh Claude Code skills from .claude/skills/",
    handler: async (_args, ctx) => {
      const oldCount = skills.length;
      refreshSkills(ctx);
      const newCount = skills.length;
      
      if (ctx.hasUI) {
        if (newCount === 0) {
          ctx.ui.notify("No skills found in .claude/skills/", "warning");
        } else {
          ctx.ui.notify(`Skills refreshed: ${newCount} loaded`, "success");
        }
      }
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("claude-skills", undefined);
    }
  });
}