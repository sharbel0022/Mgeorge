/** Production source registration point. A contract, authenticated transport and
 * exact report profile must be verified before adding an adapter here. AIS
 * credentials and browser input do not authorize a report feed. Synthetic
 * sources are injected directly by tests and are never registered here. */
export async function resolveBankgiroSource(_owner) {
  return null;
}
