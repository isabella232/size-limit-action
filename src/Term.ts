import { exec } from "@actions/exec";
import hasYarn from "has-yarn";

const INSTALL_STEP = "install";
const BUILD_STEP = "build";

class Term {
  async execSizeLimit(
    skipStep?: string,
    buildScript?: string,
    windowsVerbatimArguments?: boolean,
    directory?: string
  ): Promise<{ status: number; output: string }> {
    const manager = hasYarn() ? "yarn" : "npm";
    let output = "";

    if (skipStep !== INSTALL_STEP && skipStep !== BUILD_STEP) {
      await exec(`${manager} install`, [], {
        cwd: directory
      });
    }

    if (skipStep !== BUILD_STEP) {
      const script = buildScript || "build";
      await exec(`${manager} run ${script}`, [], {
        cwd: directory
      });
    }

    const status = await exec("npx", ["size-limit", "--json"], {
      windowsVerbatimArguments,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        }
      },
      cwd: directory
    });

    return {
      status,
      output
    };
  }
}

export default Term;
