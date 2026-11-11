class Productboard < Formula
  desc "Read-only Jira Cloud workspace for your terminal"
  homepage "https://github.com/murabcd/productboard"
  head "https://github.com/murabcd/productboard.git", branch: "main"

  depends_on "bun"
  depends_on :macos
  depends_on "node@24"

  def install
    bun = formula_opt_bin("bun")/"bun"
    system bun, "install", "--frozen-lockfile", "--production"

    libexec.install "agent", "bin", "node_modules", "package.json", "src", "tsconfig.json"
    (bin/"productboard").write_env_script libexec/"bin/productboard",
                                         BUN: bun, PATH: "#{formula_opt_bin("node@24")}:$PATH"
  end

  test do
    assert_match "Usage: productboard", shell_output("#{bin}/productboard --help")
  end
end
