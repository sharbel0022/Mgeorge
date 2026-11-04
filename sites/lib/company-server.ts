// A narrow facade for server integrations. Storage identity remains separate
// from the authenticated actor and is checked again at the effect boundary.
export {currentCompanyContext,companyBoundaryForOwner,withCompanyOwner,withCompanyRequest,companyCatalogueAction,companyGmailAccount} from './server';
