# Lua Environment Setup Action

### `step-security/gh-actions-lua`

**Note**: Requires version 8 or higher due to GitHub Actions core library updates.

Compiles and configures Lua runtime in the `.lua/` directory within your workspace.
Automatically adds `.lua/bin` to the system PATH for direct `lua` command access.


## Usage

Basic Lua installation: (Defaults to latest stable release, currently 5.4.7)

```yaml
- uses: step-security/gh-actions-lua@v11
```

Specify Lua version:

```yaml
- uses: step-security/gh-actions-lua@v11
  with:
    luaVersion: "5.1.5"
```

Install LuaJIT variant:

```yaml
- uses: step-security/gh-actions-lua@v11
  with:
    luaVersion: "luajit-2.1.0-beta3"
```

For Windows environments, include the MSVC development tools setup:
[`ilammy/msvc-dev-cmd@v1`](https://github.com/ilammy/msvc-dev-cmd). This is safe to include on all platforms.

```yaml
- uses: ilammy/msvc-dev-cmd@v1
- uses: step-security/gh-actions-lua@v11
```

## Configuration Options

### `luaVersion`

**Default**: `"5.4"`

Determines which Lua version to build and install.

Supported versions:

* `"5.1.5"`
* `"5.2.4"`
* `"5.3.6"`
* `"5.4.7"`
* `"luajit-2.0"`
* `"luajit-2.1"`
* `"luajit-master"`
* `"luajit-openresty"`

Source locations:

* `luajit-openresty` — Downloads from https://github.com/openresty/luajit2 (master branch)
* `luajit-*` variants — Downloads from https://github.com/luajit/luajit (respective branches)
* Standard versions — Downloads from https://www.lua.org/ftp/

**Quick aliases**

Use shorthand versions: `5.1`, `5.2`, `5.3`, `5.4`, `luajit` to get the latest patch version.

### `luaCompileFlags`

**Default**: `""`

Custom compilation options passed to the build system.

Usage example:

```yaml
- uses: step-security/gh-actions-lua@v11
  with:
    luaVersion: 5.3
    luaCompileFlags: LUA_CFLAGS="-DLUA_INT_TYPE=LUA_INT_INT"
```

> Compilation flags may behave differently between Lua and LuaJIT builds.

## Complete Workflow Example

Testing a Lua project with LuaRocks dependencies and [busted](https://olivinelabs.com/busted/) test framework.

Create `.github/workflows/test.yml`:

```yaml
name: test

on: [push]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@master

    - uses: step-security/gh-actions-lua@v11
      with:
        luaVersion: "5.1.5"

    - uses: leafo/gh-actions-luarocks@v4

    - name: build
      run: |
        luarocks install busted
        luarocks make

    - name: test
      run: |
        busted -o utfTerminal
```

This workflow:

* Installs Lua 5.1.5 — Change `luaVersion` for different versions or use `luajit-*` for LuaJIT
* Uses `.rockspec` from repository root for dependency management via `luarocks make`

### Multi-Version Testing

Test across multiple Lua versions using matrix builds:

```yaml
jobs:
  test:
    strategy:
      matrix:
        luaVersion: ["5.1.5", "5.2.4", "luajit-2.1.0-beta3"]

    steps:
    - uses: actions/checkout@master
    - uses: step-security/gh-actions-lua@v11
      with:
        luaVersion: ${{ matrix.luaVersion }}

    # additional steps...
```
