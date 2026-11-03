// Stability criteria groups. Each group is a regulation (or company rule set) containing
// several criteria and has its own diagram. New groups (grain, passenger, towing,
// user-defined …) are added here without changing the calculation core.
import type { GroupChart } from './types';

export interface CriteriaGroupDef {
  id: string;
  name: string;
  shortName: string;
  regulation: string;
  description: string;
  chart: GroupChart;
}

export const CRITERIA_GROUPS: CriteriaGroupDef[] = [
  {
    id: 'IS2008_GENERAL',
    name: 'IS Code 2008: General Criteria',
    shortName: 'IS 2008 General',
    regulation: 'IMO IS Code 2008, Part A, 2.2',
    description: 'Areas under the GZ curve, minimum righting lever, angle of maximum GZ and initial GM.',
    chart: 'GENERAL',
  },
  {
    id: 'OSV_INTACT',
    name: 'OSV Intact Criteria (IS Code 2008 equivalent)',
    shortName: 'OSV Intact',
    regulation: 'IS Code 2008 Part B 2.4.5 / OSV Chemical Code Ch.2, 2.2',
    description: 'Equivalent criteria for offshore supply vessels: area to the angle of maximum GZ (0.055 + 0.001·(30° − θmax)), maximum GZ at 15° or more.',
    chart: 'GENERAL',
  },
  {
    id: 'IS2008_WEATHER',
    name: 'IS Code 2008: Weather Criterion',
    shortName: 'Weather Criterion',
    regulation: 'IMO IS Code 2008, Part A, 2.3',
    description: 'Severe wind and rolling: steady wind heel and the balance of areas a and b under gust wind.',
    chart: 'WEATHER',
  },
];

export const DEFAULT_GROUP_IDS = ['IS2008_GENERAL', 'IS2008_WEATHER'];
