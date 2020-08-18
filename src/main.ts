import path from "path";
import { promises as fs } from "fs";

import { getInput, setFailed } from "@actions/core";
import { context, GitHub } from "@actions/github";
import * as artifact from "@actions/artifact";
// import {exec} from '@actions/exec';
import * as glob from "@actions/glob";

// @ts-ignore
import table from "markdown-table";
import Term from "./Term";
import SizeLimit from "./SizeLimit";

const SIZE_LIMIT_URL = "https://github.com/ai/size-limit";
const SIZE_LIMIT_HEADING = `## [size-limit](${SIZE_LIMIT_URL}) report`;
const ARTIFACT_NAME = "size-limit-action";
const RESULTS_FILE = "size-limit-results.json";

async function fetchPreviousComment(
  octokit: GitHub,
  repo: { owner: string; repo: string },
  pr: { number: number }
) {
  // TODO: replace with octokit.issues.listComments when upgraded to v17
  const commentList = await octokit.paginate(
    "GET /repos/:owner/:repo/issues/:issue_number/comments",
    {
      ...repo,
      // eslint-disable-next-line camelcase
      issue_number: pr.number
    }
  );

  const sizeLimitComment = commentList.find(comment =>
    comment.body.startsWith(SIZE_LIMIT_HEADING)
  );
  return !sizeLimitComment ? null : sizeLimitComment;
}

async function run() {
  try {
    const { payload, repo } = context;
    const pr = payload.pull_request;
    const mainBranch = getInput("main_branch");
    const isMainBranch = context.ref.includes(mainBranch);

    if (!isMainBranch && !pr) {
      throw new Error(
        "No PR found. Only pull_request workflows are supported."
      );
    }

    const token = getInput("github_token");
    const skipStep = getInput("skip_step");
    const buildScript = getInput("build_script");
    const windowsVerbatimArguments =
      getInput("windows_verbatim_arguments") === "true" ? true : false;
    const octokit = new GitHub(token);
    const term = new Term();
    const limit = new SizeLimit();

    let base;
    let current;

    if (isMainBranch) {
      const { output: baseOutput } = await term.execSizeLimit(
        context.ref,
        null,
        buildScript,
        windowsVerbatimArguments
      );

      console.log(baseOutput);
      try {
        base = limit.parseResults(baseOutput);
      } catch (error) {
        console.log(
          "Error parsing size-limit output. The output should be a json."
        );
        throw error;
      }

      const resultsFilePath = path.resolve(__dirname, RESULTS_FILE);
      await fs.writeFile(resultsFilePath, base, "utf8");

      const globber = await glob.create(RESULTS_FILE, {
        followSymbolicLinks: false
      });
      const files = await globber.glob();

      const artifactClient = artifact.create();
      await artifactClient.uploadArtifact(ARTIFACT_NAME, files, __dirname);

      return;
    }

    const { status, output } = await term.execSizeLimit(
      null,
      skipStep,
      buildScript,
      windowsVerbatimArguments
    );

    try {
      // base = limit.parseResults(baseOutput);
      current = limit.parseResults(output);
    } catch (error) {
      console.log(
        "Error parsing size-limit output. The output should be a json."
      );
      throw error;
    }

    const body = [
      SIZE_LIMIT_HEADING,
      table(limit.formatResults(base, current))
    ].join("\r\n");

    const sizeLimitComment = await fetchPreviousComment(octokit, repo, pr);

    if (!sizeLimitComment) {
      try {
        await octokit.issues.createComment({
          ...repo,
          // eslint-disable-next-line camelcase
          issue_number: pr.number,
          body
        });
      } catch (error) {
        console.log(
          "Error creating comment. This can happen for PR's originating from a fork without write permissions."
        );
      }
    } else {
      try {
        await octokit.issues.updateComment({
          ...repo,
          // eslint-disable-next-line camelcase
          comment_id: sizeLimitComment.id,
          body
        });
      } catch (error) {
        console.log(
          "Error updating comment. This can happen for PR's originating from a fork without write permissions."
        );
      }
    }

    if (status > 0) {
      setFailed("Size limit has been exceeded.");
    }
  } catch (error) {
    setFailed(error.message);
  }
}

run();
