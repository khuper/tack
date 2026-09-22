import { describe, it, expect } from "bun:test";
import { readPyprojectName } from "../../src/lib/project.js";

describe("readPyprojectName", () => {
  it("reads [project] and accepts single-quoted literal strings", () => {
    expect(readPyprojectName('[project]\nname = "demo"\n')).toBe("demo");
    expect(readPyprojectName("[project]\nname = 'demo'\n")).toBe("demo");
    expect(readPyprojectName("[project]\n  name   =   \"spaced\"  # comment\n")).toBe("spaced");
  });

  it("does not take a name from a source or index table that comes first", () => {
    const content = [
      "[[tool.uv.index]]",
      'name = "private"',
      'url = "https://example.invalid/simple"',
      "",
      "[[tool.poetry.source]]",
      'name = "mirror"',
      "",
      "[tool.poetry]",
      'name = "poetry-demo"',
      "",
      "[project]",
      'name = "real-demo"',
      "",
    ].join("\n");
    expect(readPyprojectName(content)).toBe("real-demo");
  });

  it("falls back to [tool.poetry] and returns null when neither table names the project", () => {
    expect(readPyprojectName('[tool.poetry]\nname = "poetry-only"\n[tool.other]\nname = "x"\n')).toBe("poetry-only");
    expect(readPyprojectName('[tool.black]\nname = "x"\n')).toBeNull();
    expect(readPyprojectName("")).toBeNull();
  });
});
