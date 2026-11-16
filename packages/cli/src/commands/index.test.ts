import { describe, expect, it } from "vitest";

import { COMMANDS, findCommand, helpEntries, moreCommandNames, PRIMARY_COMMANDS } from "./index.js";

describe("the command registry", () => {
  it("teaches six commands first and keeps every other one reachable", () => {
    expect([...PRIMARY_COMMANDS]).toEqual(["login", "get", "url", "search", "vin", "doctor"]);
    for (const name of PRIMARY_COMMANDS) expect(findCommand(name)?.name).toBe(name);
    expect(helpEntries("primary").map((entry) => entry.name.split(" ")[0])).toEqual([...PRIMARY_COMMANDS]);
    const all = helpEntries("all").map((entry) => entry.name.split(" ")[0]);
    expect(all).toEqual(COMMANDS.filter((command) => command.name !== "onboard").map((command) => command.name));
    expect(all).toEqual(expect.arrayContaining([...PRIMARY_COMMANDS]));
    // Registry order is preserved on `all`, and the rest is exactly everything that is not primary.
    expect(moreCommandNames()).toEqual(all.filter((name) => name !== "help" && !(PRIMARY_COMMANDS as readonly string[]).includes(name)));
    expect(moreCommandNames()).toHaveLength(all.length - PRIMARY_COMMANDS.length - 1);
    expect(moreCommandNames()).not.toContain("onboard");
    expect(moreCommandNames()).not.toContain("help");
  });
});
