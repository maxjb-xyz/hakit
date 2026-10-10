export type SkillCategory =
  | 'frontend'
  | 'backend'
  | 'data'
  | 'ml_ai'
  | 'infra_devops'
  | 'mobile'
  | 'design_ux'
  | 'hardware_embedded'
  | 'game'
  | 'security'
  | 'product_pitch';
export interface SkillSeed {
  slug: string;
  name: string;
  category: SkillCategory;
  aliases: string[];
  related?: string[];
}
