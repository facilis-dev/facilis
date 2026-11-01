/**
 * Bundlers handle CSS side-effect imports; TypeScript needs the wildcard module so a component
 * module can import its colocated stylesheet (src/<component>.css) without a type error.
 */
declare module "*.css";
