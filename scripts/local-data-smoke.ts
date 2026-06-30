import {
  audienceTargetingTimezones,
  liveCampaignSpendData,
} from '../sample-data.js'

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  liveCampaignSpendData.length === 50,
  `Expected 50 campaign spend records, received ${liveCampaignSpendData.length}`,
)

const campaignNames = new Set(
  liveCampaignSpendData.map((record) => record.campaignName),
)
assert(campaignNames.size === 50, 'Campaign spend records must be distinct')

for (const record of liveCampaignSpendData) {
  assert(record.campaignName.trim().length > 0, 'Campaign name is required')
  assert(
    record.spendToday >= 100 && record.spendToday <= 5000,
    `${record.campaignName} spendToday must be between 100 and 5000`,
  )
  assert(
    /^\d{1,3}%$/.test(record.utilization),
    `${record.campaignName} utilization must be a percentage string`,
  )
}

assert(
  liveCampaignSpendData.some(
    (record) =>
      record.campaignName === 'Q3 Cloud Migration - NA' &&
      record.spendToday === 1250.5 &&
      record.utilization === '85%',
  ),
  'Expected Q3 Cloud Migration - NA smoke record',
)

const timezoneEntries = Object.entries(audienceTargetingTimezones)
assert(
  timezoneEntries.length === 15,
  `Expected 15 audience timezone mappings, received ${timezoneEntries.length}`,
)
assert(
  audienceTargetingTimezones['emea executives'] === 'Europe/London',
  'Expected EMEA Executives timezone mapping',
)

for (const [audience, timezone] of timezoneEntries) {
  assert(audience === audience.toLowerCase(), `${audience} key must be lower-case`)
  assert(
    /^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(timezone),
    `${audience} must map to an IANA-style timezone`,
  )
}

console.log('Local data smoke passed')
