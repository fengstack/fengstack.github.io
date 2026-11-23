export interface ProjectItem {
  name: string;
  description: string;
  tags: string[];
  repo: string;
}

export interface ContributionPr {
  title: string;
  url: string;
  status: string;
}

export interface ContributionItem {
  repo: string;
  repoUrl: string;
  logo: string;
  badge: string;
  badgeColor: string;
  desc: string;
  prs: ContributionPr[];
}

export const SITE = {
  name: 'fengstack',
  alternateNames: ['upowerman'],
  title: 'fengstack — 软件工程师个人主页与技术博客',
  siteName: 'fengstack 的博客',
  alternateSiteName: 'fengstack 个人主页',
  description:
    'fengstack 的个人主页与技术博客：软件工程师，专注 RPC 框架治理、分布式系统与事务、现代 AI Agent 规范驱动编程实践（SDD 与 TDD）、jOOQ/PostGIS，分享开源项目与社区实战复盘。',
  url: 'https://blog.yunitytech.top',
  email: 'gyf718@hotmail.com',
  githubUrl: 'https://github.com/fengstack',
  altGithubUrl: 'https://github.com/upowerman',
  rssPath: '/rss.xml',
  rssTitle: 'fengstack 的技术文章与开源博客',
  rssDescription:
    '专注 Java RPC 框架治理、分布式系统与事务、现代 AI Agent 编程实践（SDD/TDD）、数据库与开源实战。',
  defaultImage: '/images/avatar.png',
  logoImage: '/images/logo.png',
};

export const PROJECTS: ProjectItem[] = [
  {
    name: 'small-rpc',
    description:
      '基于 Netty 与 Hessian 的轻量级 RPC 治理框架，微内核架构、支持服务治理闭环（熔断、限流、降级、背压）与 Maven Central 发布。',
    tags: ['Java', 'Netty', 'Hessian', 'SPI', '服务治理'],
    repo: 'https://github.com/upowerman/small-rpc',
  },
  {
    name: 'jooq-postgis',
    description:
      'jOOQ 与 PostGIS 的集成库，纯 JTS、零 GeoTools 依赖，实现类型安全空间数据库 SQL 查询与复杂地理几何对象映射。',
    tags: ['Java', 'jOOQ', 'PostGIS', 'JTS', '空间计算'],
    repo: 'https://github.com/upowerman/jooq-postgis',
  },
  {
    name: 'simple-seata',
    description:
      '轻量级教学分布式事务框架，提炼 Seata 精髓，补全内嵌 TC 协调器、全局行锁、防脏写核验与双物理库可观察 AT 模式闭环。',
    tags: ['Java', '分布式事务', 'Seata AT', 'Druid AST', 'H2'],
    repo: 'https://github.com/fengstack/simple-seata',
  },
];

export const CONTRIBUTIONS: ContributionItem[] = [
  {
    repo: 'apache/dolphinscheduler',
    repoUrl: 'https://github.com/apache/dolphinscheduler',
    logo: '/images/dolphinscheduler.jpg',
    badge: '已合并',
    badgeColor: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    desc: 'Apache 顶级分布式工作流任务调度平台：为任务插件内置参数增加月/周边界占位符（month_first_day、week_first_day 等）携带日期偏移量解析支持，精确计算跨月/跨周基准边界。',
    prs: [
      {
        title:
          'PR #18726 · [Feature-16510][TaskPlugin] Support month and week boundary placeholders with date offset (已合并)',
        url: 'https://github.com/apache/dolphinscheduler/pull/18726',
        status: 'merged',
      },
    ],
  },
  {
    repo: 'openobserve/openobserve',
    repoUrl: 'https://github.com/openobserve/openobserve',
    logo: '/images/openobserve.png',
    badge: '已合并 (2 个 PR)',
    badgeColor: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    desc: 'Rust 云原生可观测性平台：解决 PromQL 分位数插值边界对齐（对齐 Prometheus 官方标准）与 _around 检索接口小分页越界安全漏洞。',
    prs: [
      {
        title:
          'PR #15142 · fix(promql): quantile interpolation keeps infinite bounds like Prometheus (已合并)',
        url: 'https://github.com/openobserve/openobserve/pull/15142',
        status: 'merged',
      },
      {
        title:
          'PR #15143 · fix(search): clamp _around page size so small or invalid sizes stop expanding (已合并)',
        url: 'https://github.com/openobserve/openobserve/pull/15143',
        status: 'merged',
      },
    ],
  },
  {
    repo: 'gotoeasy/glogcenter',
    repoUrl: 'https://github.com/gotoeasy/glogcenter',
    logo: '/images/glogcenter.png',
    badge: '已合并',
    badgeColor: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    desc: '轻量集中式日志中心：排查并修复了集群模式节点通信及转发失效问题，以及特定网络波动下 Goroutine 潜在资源泄漏风险。',
    prs: [
      {
        title: 'PR #92 · 集群模式节点通信与转发失效修复 (已合并)',
        url: 'https://github.com/gotoeasy/glogcenter/pull/92',
        status: 'merged',
      },
      {
        title: 'PR #93 · 修复潜在的 Goroutine 资源泄漏问题 (已合并)',
        url: 'https://github.com/gotoeasy/glogcenter/pull/93',
        status: 'merged',
      },
    ],
  },
];
