export class GatewayCustomerNotFoundError extends Error {
  constructor(gatewayCustomerId: string, options?: ErrorOptions) {
    super(`Gateway customer ${gatewayCustomerId} not found`, options);
    this.name = new.target.name;
  }
}
