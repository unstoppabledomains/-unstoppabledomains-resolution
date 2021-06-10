import BN from 'bn.js';
import Zns from './Zns';
import Cns from './Cns';
import UdApi from './UdApi';
import {
  Api,
  AutoNetworkConfigs,
  CnsSupportedNetworks,
  CryptoRecords,
  DnsRecord,
  DnsRecordType,
  EthersProvider,
  NamehashOptions,
  NamehashOptionsDefault,
  NamingServiceName,
  Provider,
  ResolutionMethod,
  SourceConfig,
  Web3Version0Provider,
  Web3Version1Provider,
  TokenUriMetadata,
} from './types/publicTypes';
import ResolutionError, {ResolutionErrorCode} from './errors/resolutionError';
import DnsUtils from './utils/DnsUtils';
import {findNamingServiceName, signedInfuraLink} from './utils';
import {Eip1993Factories} from './utils/Eip1993Factories';
import {NamingService} from './NamingService';
import ConfigurationError from './errors/configurationError';
import {ConfigurationErrorCode} from './errors/configurationError';
import Networking from './utils/Networking';

/**
 * Blockchain domain Resolution library - Resolution.
 * @example
 * ```
 * import Resolution from '@unstoppabledomains/resolution';
 *
 * let resolution = new Resolution({ blockchain: {
 *        cns: {
 *           url: "https://mainnet.infura.io/v3/12351245223",
 *           network: "mainnet"
 *        }
 *      }
 *   });
 *
 * let domain = "brad.zil";
 * resolution.addr(domain, "eth").then(addr => console.log(addr));;
 * ```
 */
export default class Resolution {
  /**
   * @internal
   */
  readonly serviceMap: Record<NamingServiceName, NamingService>;

  constructor({sourceConfig = undefined}: {sourceConfig?: SourceConfig} = {}) {
    const cns = isApi(sourceConfig?.cns)
      ? new UdApi(sourceConfig?.cns.url)
      : new Cns(sourceConfig?.cns);
    const zns = isApi(sourceConfig?.zns)
      ? new UdApi(sourceConfig?.zns.url)
      : new Zns(sourceConfig?.zns);
    this.serviceMap = {
      [NamingServiceName.CNS]: cns,
      [NamingServiceName.ZNS]: zns,
    };
  }

  /**
   * AutoConfigure the blockchain network between different testnets for CNS
   * We make a "net_version" JSON RPC call to the blockchain either via url or with the help of given provider.
   * @param sourceConfig - configuration object for cns
   * @returns configured Resolution object
   */
  static async autoNetwork(
    sourceConfig: AutoNetworkConfigs,
  ): Promise<Resolution> {
    const resolution = new this();
    if (!sourceConfig.cns) {
      throw new ConfigurationError(ConfigurationErrorCode.UnsupportedNetwork);
    }

    if (sourceConfig.cns) {
      resolution.serviceMap[NamingServiceName.CNS] = await Cns.autoNetwork(
        sourceConfig.cns,
      );
    }

    return resolution;
  }

  /**
   * Creates a resolution with configured infura id for cns
   * @param infura - infura project id
   * @param networks - an optional object that describes what network to use when connecting CNS default is mainnet
   */
  static infura(
    infura: string,
    networks?: {
      cns?: {
        network: CnsSupportedNetworks;
      };
    },
  ): Resolution {
    return new this({
      sourceConfig: {
        cns: {
          url: signedInfuraLink(infura, networks?.cns?.network),
          network: networks?.cns?.network || 'mainnet',
        },
      },
    });
  }

  /**
   * Creates a resolution instance with configured provider
   * @param provider - any provider compatible with EIP-1193
   * @param networks - an optional object that describes what network to use when connecting CNS default is mainnet
   * @see https://eips.ethereum.org/EIPS/eip-1193
   */
  static fromEip1193Provider(
    provider: Provider,
    networks?: {
      cns?: {
        network: CnsSupportedNetworks;
      };
    },
  ): Resolution {
    return new this({
      sourceConfig: {
        cns: {provider, network: networks?.cns?.network || 'mainnet'},
      },
    });
  }

  /**
   * Create a resolution instance from web3 0.x version provider
   * @param provider - an 0.x version provider from web3 ( must implement sendAsync(payload, callback) )
   * @param networks - Ethereum network configuration
   * @see https://github.com/ethereum/web3.js/blob/0.20.7/lib/web3/httpprovider.js#L116
   */
  static fromWeb3Version0Provider(
    provider: Web3Version0Provider,
    networks?: {
      cns?: {
        network: CnsSupportedNetworks;
      };
    },
  ): Resolution {
    return this.fromEip1193Provider(
      Eip1993Factories.fromWeb3Version0Provider(provider),
      networks,
    );
  }

  /**
   * Create a resolution instance from web3 1.x version provider
   * @param provider - an 1.x version provider from web3 ( must implement send(payload, callback) )
   * @param networks - an optional object that describes what network to use when connecting CNS default is mainnet
   * @see https://github.com/ethereum/web3.js/blob/1.x/packages/web3-core-helpers/types/index.d.ts#L165
   * @see https://github.com/ethereum/web3.js/blob/1.x/packages/web3-providers-http/src/index.js#L95
   */
  static fromWeb3Version1Provider(
    provider: Web3Version1Provider,
    networks?: {
      cns?: {
        network: CnsSupportedNetworks;
      };
    },
  ): Resolution {
    return this.fromEip1193Provider(
      Eip1993Factories.fromWeb3Version1Provider(provider),
      networks,
    );
  }

  /**
   * Creates instance of resolution from provider that implements Ethers Provider#call interface.
   * This wrapper support only `eth_call` method for now, which is enough for all the current Resolution functionality
   * @param provider - provider object
   * @param networks - an optional object that describes what network to use when connecting CNS default is mainnet
   * @see https://github.com/ethers-io/ethers.js/blob/v4-legacy/providers/abstract-provider.d.ts#L91
   * @see https://github.com/ethers-io/ethers.js/blob/v5.0.4/packages/abstract-provider/src.ts/index.ts#L224
   * @see https://docs.ethers.io/ethers.js/v5-beta/api-providers.html#jsonrpcprovider-inherits-from-provider
   * @see https://github.com/ethers-io/ethers.js/blob/master/packages/providers/src.ts/json-rpc-provider.ts
   */
  static fromEthersProvider(
    provider: EthersProvider,
    networks?: {
      cns?: {
        network: CnsSupportedNetworks;
      };
    },
  ): Resolution {
    return this.fromEip1193Provider(
      Eip1993Factories.fromEthersProvider(provider),
      networks,
    );
  }

  /**
   * Resolves given domain name to a specific currency address if exists
   * @async
   * @param domain - domain name to be resolved
   * @param ticker - currency ticker like BTC, ETH, ZIL
   * @throws [[ResolutionError]] if address is not found
   * @returns A promise that resolves in an address
   */
  async addr(domain: string, ticker: string): Promise<string> {
    return await this.record(domain, `crypto.${ticker.toUpperCase()}.address`);
  }

  /**
   * Read multi-chain currency address if exists
   * @async
   * @param domain - domain name to be resolved
   * @param ticker - currency ticker (USDT, FTM, etc.)
   * @param chain - chain version, usually means blockchain ( ERC20, BEP2, OMNI, etc. )
   * @throws [[ResolutionError]] if address is not found
   * @returns A promise that resolves in an adress
   */
  async multiChainAddr(
    domain: string,
    ticker: string,
    chain: string,
  ): Promise<string> {
    domain = this.prepareDomain(domain);
    const method = this.getNamingMethodOrThrow(domain);

    const recordKey = `crypto.${ticker.toUpperCase()}.version.${chain.toUpperCase()}.address`;
    return await method.record(domain, recordKey);
  }

  /**
   * Resolves given domain name to a verified twitter handle
   * @async
   * @param domain - domain name to be resolved
   * @throws [[ResolutionError]] if twitter is not found
   * @returns A promise that resolves in a verified twitter handle
   */
  async twitter(domain: string): Promise<string> {
    domain = this.prepareDomain(domain);
    const method = this.getNamingMethodOrThrow(domain);
    return method.twitter(domain);
  }

  /**
   * Resolve a chat id from the domain record
   * @param domain - domain name to be resolved
   * @throws [[ResolutionError]]
   * @returns A promise that resolves in chatId
   */
  async chatId(domain: string): Promise<string> {
    return await this.record(domain, 'gundb.username.value');
  }

  /**
   * Resolve a gundb public key from the domain record
   * @param domain - domain name to be resolved
   * @throws [[ResolutionError]]
   * @returns a promise that resolves in gundb public key
   */
  async chatPk(domain: string): Promise<string> {
    return await this.record(domain, 'gundb.public_key.value');
  }

  /**
   * Resolves the IPFS hash configured for domain records on ZNS
   * @param domain - domain name
   * @throws [[ResolutionError]]
   */
  async ipfsHash(domain: string): Promise<string> {
    domain = this.prepareDomain(domain);
    return await this.getPreferableNewRecord(
      domain,
      'dweb.ipfs.hash',
      'ipfs.html.value',
    );
  }

  /**
   * Resolves the httpUrl attached to domain
   * @param domain - domain name
   */
  async httpUrl(domain: string): Promise<string> {
    domain = this.prepareDomain(domain);
    return await this.getPreferableNewRecord(
      domain,
      'browser.redirect_url',
      'ipfs.redirect_domain.value',
    );
  }

  /**
   * Resolves the ipfs email field from whois configurations
   * @param domain - domain name
   * @throws [[ResolutionError]]
   * @returns A Promise that resolves in an email address configured for this domain whois
   */
  async email(domain: string): Promise<string> {
    return await this.record(domain, 'whois.email.value');
  }

  /**
   * @returns the resolver address for a specific domain
   * @param domain - domain to look for
   */
  async resolver(domain: string): Promise<string> {
    domain = this.prepareDomain(domain);
    const resolver = await this.getNamingMethodOrThrow(domain).resolver(domain);
    if (!resolver) {
      throw new ResolutionError(ResolutionErrorCode.UnspecifiedResolver, {
        domain,
      });
    }
    return resolver;
  }

  /**
   * @param domain - domain name
   * @returns An owner address of the domain
   */
  async owner(domain: string): Promise<string | null> {
    domain = this.prepareDomain(domain);
    const method = this.getNamingMethodOrThrow(domain);
    return (await method.owner(domain)) || null;
  }

  /**
   * @param domain - domain name
   * @param recordKey - a name of a record to be resolved
   * @returns A record value promise for a given record name
   */
  async record(domain: string, recordKey: string): Promise<string> {
    domain = this.prepareDomain(domain);
    const method = this.getNamingMethodOrThrow(domain);
    return await method.record(domain, recordKey);
  }

  /**
   * @param domain domain name
   * @param keys Array of record keys to be resolved
   * @returns A Promise with key-value mapping of domain records
   */
  async records(domain: string, keys: string[]): Promise<CryptoRecords> {
    domain = this.prepareDomain(domain);
    const method = this.getNamingMethodOrThrow(domain);
    return await method.records(domain, keys);
  }

  /**
   * @param domain domain name
   * @returns A Promise of whether or not the domain belongs to a wallet
   */
  async isRegistered(domain: string): Promise<Boolean> {
    domain = this.prepareDomain(domain);
    const method = this.getNamingMethodOrThrow(domain);
    return await method.isRegistered(domain);
  }

  /**
   * @returns Produces a namehash from supported naming service in hex format with 0x prefix.
   * Corresponds to ERC721 token id in case of Ethereum based naming service like CNS.
   * @param domain domain name to be converted
   * @param options formatting options
   * @throws [[ResolutionError]] with UnsupportedDomain error code if domain extension is unknown
   */
  namehash(
    domain: string,
    options: NamehashOptions = NamehashOptionsDefault,
  ): string {
    domain = this.prepareDomain(domain);
    return this.formatNamehash(
      this.getNamingMethodOrThrow(domain).namehash(domain),
      options,
    );
  }

  /**
   * @returns a namehash of a subdomain with name label
   * @param parent namehash of a parent domain
   * @param label subdomain name
   * @param namingService "CNS" or "ZNS"
   * @param options formatting options
   */
  childhash(
    parent: string,
    label: string,
    namingService: NamingServiceName,
    options: NamehashOptions = NamehashOptionsDefault,
  ): string {
    const service = this.serviceMap[namingService];
    if (!service) {
      throw new ResolutionError(ResolutionErrorCode.UnsupportedService, {
        namingService,
      });
    }
    return this.formatNamehash(service.childhash(parent, label), options);
  }

  private formatNamehash(hash, options: NamehashOptions) {
    hash = hash.replace('0x', '');
    if (options.format === 'dec') {
      return new BN(hash, 'hex').toString(10);
    } else {
      return options.prefix ? '0x' + hash : hash;
    }
  }

  /**
   * Checks weather the domain name matches the hash
   * @param domain - domain name to check againt
   * @param hash - hash obtained from the blockchain
   */
  isValidHash(domain: string, hash: string): boolean {
    domain = this.prepareDomain(domain);
    return this.namehash(domain) === hash;
  }

  /**
   * Checks if the domain name is valid according to naming service rules
   * for valid domain names.
   * @param domain - domain name to be checked
   */
  isSupportedDomain(domain: string): boolean {
    domain = this.prepareDomain(domain);
    return !!this.getNamingMethod(domain)?.isSupportedDomain(domain);
  }

  /**
   * Returns the name of the service for a domain CNS | ZNS
   * @param domain - domain name to look for
   */
  serviceName(domain: string): ResolutionMethod {
    domain = this.prepareDomain(domain);
    return this.getNamingMethodOrThrow(domain).serviceName();
  }

  /**
   * Returns all record keys of the domain.
   * This method is strongly unrecommended for production use due to lack of support for many ethereum service providers and low performance
   * @param domain - domain name
   */
  async allRecords(domain: string): Promise<CryptoRecords> {
    domain = this.prepareDomain(domain);
    return await this.getNamingMethodOrThrow(domain).allRecords(domain);
  }

  async dns(domain: string, types: DnsRecordType[]): Promise<DnsRecord[]> {
    const dnsUtils = new DnsUtils();
    domain = this.prepareDomain(domain);
    const method = this.getNamingMethodOrThrow(domain);
    const dnsRecordKeys = this.getDnsRecordKeys(types);
    const blockchainData = await method.records(domain, dnsRecordKeys);
    return dnsUtils.toList(blockchainData);
  }

  /**
   * Retrieves the tokenURI from the registry smart contract.
   * @returns the ERC721Metadata#tokenURI contract method result
   * @param domain - domain name
   */
  async tokenURI(domain: string): Promise<string> {
    const namehash = this.namehash(domain);
    return this.getNamingMethodOrThrow(domain).getTokenUri(namehash);
  }

  /**
   * Retrieves the data from the endpoint provided by tokenURI from the registry smart contract.
   * @returns the JSON response of the token URI endpoint
   * @param domain - domain name
   */
  async tokenURIMetadata(domain: string): Promise<TokenUriMetadata> {
    const tokenUri = await this.tokenURI(domain);
    return this.getMetadataFromTokenURI(tokenUri);
  }

  /**
   * Retrieves the domain name from token metadata that is provided by tokenURI from the registry smart contract.
   * The function will throw an error if the domain in the metadata does not match the hash (e.g. if the metadata is outdated).
   * @returns the domain name retrieved from token metadata
   * @param hash - domain hash
   * @param service - nameservice which is used for lookup
   */
  async unhash(hash: string, service: NamingServiceName): Promise<string> {
    const tokenUri = await this.serviceMap[service].getTokenUri(hash);
    const metadata = await this.getMetadataFromTokenURI(tokenUri);
    return metadata.name;
  }

  private async getMetadataFromTokenURI(
    tokenUri: string,
  ): Promise<TokenUriMetadata> {
    const resp = await Networking.fetch(tokenUri, {});
    if (resp.ok) {
      return await resp.json();
    }

    throw new ResolutionError(ResolutionErrorCode.ServiceProviderError, {
      providerMessage: await resp.text(),
      method: 'UDAPI',
      methodName: 'tokenURIMetadata',
    });
  }

  private getDnsRecordKeys(types: DnsRecordType[]): string[] {
    const records = ['dns.ttl'];
    types.forEach((type) => {
      records.push(`dns.${type}`);
      records.push(`dns.${type}.ttl`);
    });
    return records;
  }

  private async getPreferableNewRecord(
    domain: string,
    newRecord: string,
    oldRecord: string,
  ): Promise<string> {
    const records = await this.records(domain, [newRecord, oldRecord]);
    if (!records[newRecord] && !records[oldRecord]) {
      throw new ResolutionError(ResolutionErrorCode.RecordNotFound, {
        recordName: newRecord,
        domain: domain,
      });
    }
    return records[newRecord] || records[oldRecord];
  }

  private getNamingMethod(domain: string): NamingService | undefined {
    return this.serviceMap[findNamingServiceName(domain)];
  }

  private getNamingMethodOrThrow(domain: string): NamingService {
    const method = this.getNamingMethod(domain);
    if (!method) {
      throw new ResolutionError(ResolutionErrorCode.UnsupportedDomain, {
        domain,
      });
    }

    return method;
  }

  private prepareDomain(domain: string): string {
    return domain ? domain.trim().toLowerCase() : '';
  }
}

export {Resolution};

function isApi(obj: any): obj is Api {
  return obj && obj.api;
}
