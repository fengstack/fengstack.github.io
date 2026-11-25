import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';

/** Wrap Markdown tables in a scrollable container so narrow tables stay full-width while wide tables scroll horizontally. */
function rehypeWrapTable() {
  function hasTableWrapperClass(node) {
    const className = node?.properties?.className;
    return Array.isArray(className) ? className.includes('table-wrapper') : className === 'table-wrapper';
  }

  function transformNode(node) {
    if (!node || !Array.isArray(node.children)) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child?.type === 'element' && child.tagName === 'table' && !hasTableWrapperClass(node)) {
        node.children[i] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['table-wrapper'] },
          children: [child],
        };
      } else {
        transformNode(child);
      }
    }
  }

  return (tree) => {
    transformNode(tree);
  };
}

export default defineConfig({
  site: 'https://blog.yunitytech.top',
  trailingSlash: 'always',
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    mdx(),
  ],
  markdown: {
    rehypePlugins: [rehypeWrapTable],
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      wrap: false,
    },
  },
});
