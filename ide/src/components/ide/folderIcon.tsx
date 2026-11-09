// Folder-shape icons from the Iconify "vscode-icons" set, picked by the folder's
// basename so the Explorer reads like VS Code: `locales/` and `server/` are
// distinguishable at a glance, and every project that follows the same conventions
// looks the same.
//
// unplugin-icons needs *static* imports, so the well-known folder names are
// enumerated here; anything else falls back to the generic folder pair. Matching is
// by basename only (not the full path), because a nested `src/components` should
// read exactly like a top-level `components/`, and lowercased so `Locales/` hits
// the same entry. Aliases are deliberate where several conventions name the same
// concept (`test`/`tests`, `pages`/`layouts`, `lib`/`library`).

import type { SVGProps, ComponentType } from "react";

import DefaultFolder from "~icons/vscode-icons/default-folder";
import DefaultFolderOpen from "~icons/vscode-icons/default-folder-opened";
import Api from "~icons/vscode-icons/folder-type-api";
import ApiOpen from "~icons/vscode-icons/folder-type-api-opened";
import Asset from "~icons/vscode-icons/folder-type-asset";
import AssetOpen from "~icons/vscode-icons/folder-type-asset-opened";
import Auth from "~icons/vscode-icons/folder-type-auth";
import AuthOpen from "~icons/vscode-icons/folder-type-auth-opened";
import Component from "~icons/vscode-icons/folder-type-component";
import ComponentOpen from "~icons/vscode-icons/folder-type-component-opened";
import Config from "~icons/vscode-icons/folder-type-config";
import ConfigOpen from "~icons/vscode-icons/folder-type-config-opened";
import Coverage from "~icons/vscode-icons/folder-type-coverage";
import CoverageOpen from "~icons/vscode-icons/folder-type-coverage-opened";
import Db from "~icons/vscode-icons/folder-type-db";
import DbOpen from "~icons/vscode-icons/folder-type-db-opened";
import Dist from "~icons/vscode-icons/folder-type-dist";
import DistOpen from "~icons/vscode-icons/folder-type-dist-opened";
import Docs from "~icons/vscode-icons/folder-type-docs";
import DocsOpen from "~icons/vscode-icons/folder-type-docs-opened";
import E2e from "~icons/vscode-icons/folder-type-e2e";
import E2eOpen from "~icons/vscode-icons/folder-type-e2e-opened";
import Fonts from "~icons/vscode-icons/folder-type-fonts";
import FontsOpen from "~icons/vscode-icons/folder-type-fonts-opened";
import Git from "~icons/vscode-icons/folder-type-git";
import GitOpen from "~icons/vscode-icons/folder-type-git-opened";
import Github from "~icons/vscode-icons/folder-type-github";
import GithubOpen from "~icons/vscode-icons/folder-type-github-opened";
import Hook from "~icons/vscode-icons/folder-type-hook";
import HookOpen from "~icons/vscode-icons/folder-type-hook-opened";
import Images from "~icons/vscode-icons/folder-type-images";
import ImagesOpen from "~icons/vscode-icons/folder-type-images-opened";
import Library from "~icons/vscode-icons/folder-type-library";
import LibraryOpen from "~icons/vscode-icons/folder-type-library-opened";
import Locale from "~icons/vscode-icons/folder-type-locale";
import LocaleOpen from "~icons/vscode-icons/folder-type-locale-opened";
import Middleware from "~icons/vscode-icons/folder-type-middleware";
import MiddlewareOpen from "~icons/vscode-icons/folder-type-middleware-opened";
import NodeFolder from "~icons/vscode-icons/folder-type-node";
import NodeFolderOpen from "~icons/vscode-icons/folder-type-node-opened";
import Package from "~icons/vscode-icons/folder-type-package";
import PackageOpen from "~icons/vscode-icons/folder-type-package-opened";
import Plugin from "~icons/vscode-icons/folder-type-plugin";
import PluginOpen from "~icons/vscode-icons/folder-type-plugin-opened";
import Public from "~icons/vscode-icons/folder-type-public";
import PublicOpen from "~icons/vscode-icons/folder-type-public-opened";
import Route from "~icons/vscode-icons/folder-type-route";
import RouteOpen from "~icons/vscode-icons/folder-type-route-opened";
import Schema from "~icons/vscode-icons/folder-type-schema";
import SchemaOpen from "~icons/vscode-icons/folder-type-schema-opened";
import Script from "~icons/vscode-icons/folder-type-script";
import ScriptOpen from "~icons/vscode-icons/folder-type-script-opened";
import Server from "~icons/vscode-icons/folder-type-server";
import ServerOpen from "~icons/vscode-icons/folder-type-server-opened";
import Src from "~icons/vscode-icons/folder-type-src";
import SrcOpen from "~icons/vscode-icons/folder-type-src-opened";
import Style from "~icons/vscode-icons/folder-type-style";
import StyleOpen from "~icons/vscode-icons/folder-type-style-opened";
import Template from "~icons/vscode-icons/folder-type-template";
import TemplateOpen from "~icons/vscode-icons/folder-type-template-opened";
import Test from "~icons/vscode-icons/folder-type-test";
import TestOpen from "~icons/vscode-icons/folder-type-test-opened";
import Theme from "~icons/vscode-icons/folder-type-theme";
import ThemeOpen from "~icons/vscode-icons/folder-type-theme-opened";
import Typings from "~icons/vscode-icons/folder-type-typings";
import TypingsOpen from "~icons/vscode-icons/folder-type-typings-opened";
import View from "~icons/vscode-icons/folder-type-view";
import ViewOpen from "~icons/vscode-icons/folder-type-view-opened";

type IconCmp = ComponentType<SVGProps<SVGSVGElement>>;
type FolderIcons = { closed: IconCmp; open: IconCmp };

const pair = (closed: IconCmp, open: IconCmp): FolderIcons => ({ closed, open });

const BY_NAME: Record<string, FolderIcons> = {
  api: pair(Api, ApiOpen),
  assets: pair(Asset, AssetOpen),
  auth: pair(Auth, AuthOpen),
  components: pair(Component, ComponentOpen),
  ui: pair(Component, ComponentOpen),
  coverage: pair(Coverage, CoverageOpen),
  db: pair(Db, DbOpen),
  schema: pair(Schema, SchemaOpen),
  migrations: pair(Schema, SchemaOpen),
  dist: pair(Dist, DistOpen),
  ".output": pair(Dist, DistOpen),
  docs: pair(Docs, DocsOpen),
  e2e: pair(E2e, E2eOpen),
  test: pair(Test, TestOpen),
  tests: pair(Test, TestOpen),
  fonts: pair(Fonts, FontsOpen),
  ".git": pair(Git, GitOpen),
  ".github": pair(Github, GithubOpen),
  hooks: pair(Hook, HookOpen),
  images: pair(Images, ImagesOpen),
  brand: pair(Images, ImagesOpen),
  lib: pair(Library, LibraryOpen),
  locale: pair(Locale, LocaleOpen),
  locales: pair(Locale, LocaleOpen),
  middleware: pair(Middleware, MiddlewareOpen),
  node_modules: pair(NodeFolder, NodeFolderOpen),
  package: pair(Package, PackageOpen),
  packages: pair(Package, PackageOpen),
  vendor: pair(Package, PackageOpen),
  plugins: pair(Plugin, PluginOpen),
  public: pair(Public, PublicOpen),
  routes: pair(Route, RouteOpen),
  scripts: pair(Script, ScriptOpen),
  server: pair(Server, ServerOpen),
  src: pair(Src, SrcOpen),
  styles: pair(Style, StyleOpen),
  starter: pair(Template, TemplateOpen),
  examples: pair(Template, TemplateOpen),
  themes: pair(Theme, ThemeOpen),
  types: pair(Typings, TypingsOpen),
  layouts: pair(View, ViewOpen),
  pages: pair(View, ViewOpen),
  ".facilis": pair(Config, ConfigOpen),
};

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function FolderIcon({
  name,
  open,
  className,
}: {
  name?: string;
  open?: boolean;
  className?: string;
}) {
  const known = name ? BY_NAME[baseName(name).toLowerCase()] : undefined;
  const Cmp = known ? (open ? known.open : known.closed) : open ? DefaultFolderOpen : DefaultFolder;
  return <Cmp className={className} />;
}
