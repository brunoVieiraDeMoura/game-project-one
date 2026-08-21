import { execFileSync } from "node:child_process";

const out = execFileSync(
  "wsl",
  ["-d", "Ubuntu", "-u", "root", "mariadb", "gameproject", "-N", "-e", "SELECT 1+1;"],
  { encoding: "utf8" },
);
console.log("RESULT:", JSON.stringify(out));
