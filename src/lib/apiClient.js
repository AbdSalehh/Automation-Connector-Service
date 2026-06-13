import axios from "axios";

/**
 * Instance Axios terpusat untuk pemanggilan HTTP outbound,
 * misalnya meneruskan pesan masuk ke webhook AutoFlow.
 */
export const apiClient = axios.create({
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});
