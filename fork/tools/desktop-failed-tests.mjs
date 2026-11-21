// Usage: node fork/tools/desktop-failed-tests.mjs <vitest-json> <out.txt>
import * as NodeFS from "node:fs";
const [input, output] = process.argv.slice(2);
const report = JSON.parse(NodeFS.readFileSync(input, "utf8"));
const names = report.testResults.flatMap((file) =>
  file.assertionResults
    .filter((test) => test.status === "failed")
    .map(
      (test) =>
        `${file.name.replaceAll("\\", "/").replace(/^.*?(apps\/desktop\/)/, "$1")} > ${test.fullName}`,
    ),
);
NodeFS.writeFileSync(output, `${[...new Set(names)].sort().join("\n")}\n`);
