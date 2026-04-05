jest.mock('../supabase', () => ({ supabase: {} }))

import { parseTeamsFromBetName } from '../espn'

describe('parseTeamsFromBetName', () => {
  test('featured market — simple "Team1 vs Team2"', () => {
    expect(parseTeamsFromBetName('Washington Wizards vs Miami Heat')).toEqual([
      'Washington Wizards',
      'Miami Heat',
    ])
  })

  test('featured market with em-dash suffix', () => {
    expect(parseTeamsFromBetName('Warriors vs Celtics \u2014 Moneyline \u2014 Warriors')).toEqual([
      'Warriors',
      'Celtics',
    ])
  })

  test('prop bet — strips StatType and player after " - "', () => {
    expect(
      parseTeamsFromBetName('Washington Wizards vs Miami Heat - Rebounds - Adebayo, B - Under 11.5')
    ).toEqual(['Washington Wizards', 'Miami Heat'])
  })

  test('prop bet — points', () => {
    expect(
      parseTeamsFromBetName('Mavericks vs Lakers - Points - Doncic, L - Over 33.5')
    ).toEqual(['Mavericks', 'Lakers'])
  })

  test('prop bet — team name with hyphen not confused with separator', () => {
    // The " - " separator is space-dash-space; a hyphenated team like "Trail-Blazers" won't match
    expect(
      parseTeamsFromBetName('Trail-Blazers vs Nuggets - Points - Murray, J - Over 25.5')
    ).toEqual(['Trail-Blazers', 'Nuggets'])
  })

  test('no "vs" — returns null', () => {
    expect(parseTeamsFromBetName('Warriors Celtics — Moneyline')).toBeNull()
  })

  test('"vs" in team name preserved correctly', () => {
    // e.g. if event had "vs" somehow; just ensure the first vs is the split point
    expect(parseTeamsFromBetName('Nets vs Knicks - Spread - Nets -3.5')).toEqual([
      'Nets',
      'Knicks',
    ])
  })
})
