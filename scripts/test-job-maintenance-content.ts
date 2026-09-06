import assert from 'node:assert/strict';
import { extractOfficialJobRequirements, looksLikeBlockedPage, usableOfficialContent } from '@/lib/job-maintenance';
import { deutscheBankDetailsFromApi, extractOfficialJobDetails, isJobContentShell } from '@/lib/job-official-detail';
import { parseExperience } from '@/lib/job-connectors/utils';

const page = `
  About the role\n
  Build reliable distributed systems for our customers.\n
  Basic Qualifications:\n
  - 3+ years of professional software development experience\n
  - Experience with TypeScript and SQL\n
  Preferred Qualifications:\n
  - Experience with cloud infrastructure\n
  Benefits: Medical coverage and paid leave.
`;

const content = usableOfficialContent(page);
assert.ok(content);
assert.equal(usableOfficialContent('Career search'), null);
assert.equal(usableOfficialContent('Job title | Company {&#34;themeOptions&#34;: {&#34;customTheme&#34;: {&#34;varTheme&#34;: {}}}} ' + 'x'.repeat(200)), null);
const requirements = extractOfficialJobRequirements(content!);
assert.ok(requirements?.includes('3+ years'));
assert.ok(requirements?.includes('TypeScript'));
assert.equal(requirements?.includes('Benefits'), false);
const experience = parseExperience([content!]);
assert.equal(experience.min, 3);
assert.equal(experience.max, null);

const structured = extractOfficialJobDetails({
  title: 'Intern | Example',
  content: 'Checking your browser',
  url: 'https://example.com/job/1',
  httpStatus: 200,
  metadata: {
    structured_data: [{
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Intern',
      description: 'Responsibilities: Work with the team on customer research and reporting. Qualifications: Current student with strong communication skills and analytical ability.',
      validThrough: '2027-02-21T00:00:00Z',
      jobLocation: { address: { addressLocality: 'Seattle', addressRegion: 'WA', addressCountry: 'US' } },
    }],
  },
});
assert.equal(structured?.source, 'official_structured_data');
assert.ok(structured?.description?.includes('Responsibilities'));
assert.equal(structured?.validThrough, '2027-02-21T00:00:00Z');
assert.equal(structured?.location, 'Seattle, WA, US');
assert.equal(looksLikeBlockedPage('Intern | Example', 'This page includes a recaptcha script'), false);
assert.equal(looksLikeBlockedPage('Access denied', 'Verify you are human'), true);
assert.equal(isJobContentShell('{"widget":"redirect","externalSpa":true}'), true);
assert.equal(isJobContentShell('A real job description'), false);

const deloitteDetails = extractOfficialJobDetails({
  title: 'Lead Data Engineer II',
  content: '<html><body><div class="article__header--locations "><div class="fluid-cols fluid-cols--cols2"><p class="paragraph">Philadelphia, Pennsylvania, United States</p></div></div><p>Qualifications Required: Bachelor\'s degree in Computer Science.</p></body></html>',
  url: 'https://apply.deloitte.com/en_US/careers/JobDetail/Lead-Data-Engineer-II/365629',
  httpStatus: 200,
  metadata: {
    structured_data: [{
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Lead Data Engineer II',
      description: 'Qualifications Required: Bachelor\'s degree in Computer Science, Engineering, Information Systems, or a technical field, or equivalent experience. 6+ years of experience designing, building, and maintaining data pipelines and cloud-based data platforms.',
      jobLocation: { address: { streetAddress: '', addressLocality: '', addressRegion: null, addressCountry: null } },
    }],
  },
});
assert.equal(deloitteDetails?.location, 'Philadelphia, Pennsylvania, United States');


// Deutsche Bank official beesite API detail payload (real sample shape).
const deutscheBankDetails = deutscheBankDetailsFromApi({
  html: '<div id="db-jobad"><h1>Senior Alternative Specialist (Private Real Assets), APAC</h1>' +
    '<div id="headerbox"><table><tr><td><strong>Job ID:</strong>R0250048</td><td><strong>Full/Part-Time: </strong>Full-time</td></tr>' +
    '<tr><td><strong>Regular/Temporary: </strong>Regular</td><td><strong>Listed: </strong>2026-08-26</td></tr>' +
    '<tr><td colspan="2"><strong>Location: </strong>Tokyo</td></tr></table></div>' +
    '<h2>Position Overview</h2><p>As our Senior Alternative Specialist you will work with generalist sales professionals ' +
    'to raise capital from institutional investors and expand distribution. This professional will focus on private real ' +
    'asset strategies, both equity and debt. You bring deep experience and a proven track record in the industry.</p></div>',
  apply_uri: 'https://db.wd3.myworkdayjobs.com/DBWebsite/job/Tokyo/Senior-Alternative-Specialists--APAC_R0250048/apply',
});
assert.equal(deutscheBankDetails?.source, 'official_structured_data');
assert.equal(deutscheBankDetails?.location, 'Tokyo');
assert.equal(deutscheBankDetails?.employmentType, 'Full-time');
assert.equal(deutscheBankDetails?.validThrough, null);
assert.ok(deutscheBankDetails?.description?.includes('institutional investors'));
assert.equal(deutscheBankDetailsFromApi({ html: '<p>tiny</p>' }), null);
assert.equal(deutscheBankDetailsFromApi(null), null);

// Bain & Company official detail page (server-rendered text form).
const bainDetails = extractOfficialJobDetails({
  title: 'Strategic Designer - 109256',
  content: 'Strategic Designer - 109256 Skip to content Bain & Company, Inc. Menu Search jobs Register Login Strategic Designer General Information Job Title Strategic Designer Job ID 109256 Work Areas Design Employment Type Permanent Full-Time Location(s) New York, San Francisco Description & Requirements Strategic Designer Locations: New York, NY | San Francisco, CA WHAT MAKES US A GREAT PLACE TO WORK We are proud to be consistently recognized as one of the world’s best places to work. Extraordinary teams are at the heart of our business strategy. We hire people with exceptional talent and create an environment in which every individual can thrive professionally and personally.',
  url: 'https://careers.bain.com/jobs/FolderDetail/Designer/109256',
  httpStatus: 200,
  metadata: { structured_data: [{ '@context': 'https://schema.org/', '@type': 'JobPosting', title: 'Designer', datePosted: '2026-08-24' }] },
});
assert.equal(bainDetails?.source, 'official_page_text');
assert.equal(bainDetails?.location, 'New York, San Francisco');
assert.equal(bainDetails?.employmentType, 'Permanent Full-Time');
assert.ok(bainDetails?.description?.includes('Strategic Designer'));

// Two Sigma official detail page.
const twoSigmaDetails = extractOfficialJobDetails({
  title: 'Technical Program Manager - New York - Two Sigma Careers',
  content: 'Technical Program Manager Location NY New York United States Business Investment Management Function Engineering Experience Level Experienced Apply Share this job Position Summary Two Sigma is a leading quantitative investment management and trading firm. The company applies a scientific approach to investing, combining cutting-edge technology, artificial intelligence, data science, and quantitative research with rigorous human inquiry to capitalize on market opportunities and deliver alpha for investors. Our team of engineers, quantitative researchers and data scientists looks beyond the traditional to test hypotheses and develop creative solutions.',
  url: 'https://careers.twosigma.com/careers/JobDetail/New-York-United-States-Technical-Program-Manager/13854',
  httpStatus: 200,
});
assert.equal(twoSigmaDetails?.source, 'official_page_text');
assert.equal(twoSigmaDetails?.location, 'NY New York United States');
assert.ok(twoSigmaDetails?.description?.includes('quantitative investment management'));

// Evercore Taleo official detail page (text form).
const evercoreDetails = extractOfficialJobDetails({
  title: 'Senior Analyst / Junior Associate - Strategic Defense & Shareholder Advisory - New York - Evercore',
  content: 'Senior Analyst / Junior Associate - Strategic Defense & Shareholder Advisory - New York - Evercore Skip to content Login | Register Senior Analyst / Junior Associate - Strategic Defense & Shareholder Advisory - New York Region Americas Location New York Group Investment Banking Job description Primary Responsibilities: The Analyst will provide value add analysis and research as part of the Strategic, Defense, and Shareholder Advisory team within the Advisory business. In this role, the Analyst will create client presentations regarding hostile activity, proxy fights, shareholder activism, and corporate governance. The Analyst will work in a team environment within Evercore’s Strategic, Defense, and Shareholder Advisory practice. Specific Qualifications: Third-year Analyst or junior Associate with investment banking experience preferred; MBA Class of 2026 candidates will also be considered.',
  url: 'https://evercore.tal.net/vx/mobile-0/appcentre-ext/brand-4/candidate/so/pm/1/pl/3/opp/3267/en-GB',
  httpStatus: 200,
});
assert.equal(evercoreDetails?.source, 'official_page_text');
assert.equal(evercoreDetails?.location, 'New York');
assert.ok(evercoreDetails?.description?.includes('Primary Responsibilities'));

// Accenture official jobdetails page JSON-LD: structured jobLocation,
// OccupationalExperienceRequirements months range, and "unavailable"
// placeholders for salary must be ignored.
const accentureDetails = extractOfficialJobDetails({
  title: '^NET Postgres SQL Delivery - 6452016',
  content: '<div>Job Description Accenture Flex offers you the flexibility of local fixed-duration project-based work powered by Accenture.</div>',
  url: 'https://www.accenture.com/us-en/careers/jobdetails?id=14660238_en',
  httpStatus: 200,
  metadata: {
    structured_data: [{
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: '^NET Postgres SQL Delivery - 6452016',
      jobLocation: [{
        '@type': 'Place',
        address: { addressLocality: 'Irving', addressRegion: 'TX', addressCountry: 'USA', postalCode: 'unavailable', streetAddress: 'unavailable' },
      }],
      experienceRequirements: { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: '24-60' },
      baseSalary: { '@type': 'MonetaryAmount', currency: 'unavailable', value: { '@type': 'QuantitativeValue', value: 'unavailable', unitText: 'unavailable' } },
      employmentType: 'Full-time',
      validThrough: '2027-08-26T13:46:32.648-07:00',
      qualifications: '<p><u>Basic Qualifications:</u></p><ul><li><p>Minimum 3+ years of experience working with data management.</p></li></ul>',
    }],
  },
});
assert.equal(accentureDetails?.source, 'official_structured_data');
assert.equal(accentureDetails?.location, 'Irving, TX, USA');
assert.equal(accentureDetails?.salaryRange, null);
assert.equal(accentureDetails?.experience, '2-5 years');
assert.equal(accentureDetails?.validThrough, '2027-08-26T13:46:32.648-07:00');
assert.equal(accentureDetails?.employmentType, 'Full-time');

// Jefferies Taleo official detail page: "Location New York" label before
// Business unit(s), Program type etc.
const jefferiesDetails = extractOfficialJobDetails({
  title: '2027 Investment Banking Summer Associate Program - Evercore Careers',
  content: '2027 Investment Banking Summer Associate Program Location New York Business unit(s) Investment Banking Program type Summer Associate Graduation Requirement December 2027 - June 2028 Job description The Summer Associate Program is a 10-week summer program for MBA students. As a Summer Associate, you will be responsible for day-to-day execution of a broad array of transactions, as well as originating new business opportunities. Requirements: MBA students graduating between December 2027 and June 2028 are eligible.',
  url: 'https://jefferies.tal.net/vx/mobile-0/appcentre-ext/brand-4/candidate/so/pm/1/pl/2/opp/1909-2027-Investment-Banking-Summer-Internship',
  httpStatus: 200,
});
assert.equal(jefferiesDetails?.source, 'official_page_text');
assert.equal(jefferiesDetails?.location, 'New York');
assert.ok(jefferiesDetails?.description?.includes('Summer Associate Program'));

console.log('job maintenance content tests passed');
