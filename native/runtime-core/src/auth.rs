use crate::{AuthenticatedJobContext, StoreError};
use breadboard_runtime_protocol::{MAX_CONTROL_TOKEN_BYTES, MIN_CONTROL_TOKEN_BYTES};
use std::fmt;
use thiserror::Error;

const BEARER_PREFIX: &[u8] = b"Bearer ";

/// The trusted bridge between the authenticated loopback control server and
/// the durable job store.
///
/// Request payloads cannot construct `AuthenticatedJobContext` directly. The
/// runtime host owns one of these authorities for a single launch and invokes
/// it only after its HTTP parser has enforced the bounded control protocol.
pub struct ControlPlaneAuthority {
    control_token: Box<[u8]>,
}

impl ControlPlaneAuthority {
    pub fn new(control_token: impl AsRef<str>) -> Result<Self, AuthenticationError> {
        let bytes = control_token.as_ref().as_bytes();
        if bytes.len() < MIN_CONTROL_TOKEN_BYTES
            || bytes.len() > MAX_CONTROL_TOKEN_BYTES
            || !bytes.iter().all(|byte| byte.is_ascii_graphic())
        {
            return Err(AuthenticationError::InvalidControlToken);
        }
        Ok(Self {
            control_token: bytes.to_vec().into_boxed_slice(),
        })
    }

    /// Authenticates the private server-to-server bearer before accepting the
    /// user and scope already verified by the Next compatibility layer.
    pub fn authenticate_user(
        &self,
        authorization: Option<&str>,
        user_id: i64,
        garden_id: Option<&str>,
        conversation_id: Option<&str>,
    ) -> Result<AuthenticatedJobContext, AuthenticationError> {
        self.verify_bearer(authorization)?;
        Ok(AuthenticatedJobContext::for_verified_user(
            user_id,
            garden_id,
            conversation_id,
        )?)
    }

    /// Mints authority for runtime-owned schedulers and adapters. This method
    /// deliberately lives on the non-serializable launch authority rather than
    /// accepting an HTTP bearer or an ordinary request field.
    pub fn trusted_internal_context(
        &self,
        internal_id: &str,
        garden_id: Option<&str>,
        conversation_id: Option<&str>,
    ) -> Result<AuthenticatedJobContext, AuthenticationError> {
        Ok(AuthenticatedJobContext::for_trusted_internal(
            internal_id,
            garden_id,
            conversation_id,
        )?)
    }

    pub fn verify_bearer(&self, authorization: Option<&str>) -> Result<(), AuthenticationError> {
        let Some(header) = authorization else {
            return Err(AuthenticationError::Unauthorized);
        };
        let bytes = header.as_bytes();
        if bytes.len() < BEARER_PREFIX.len()
            || !constant_time_equal(&bytes[..BEARER_PREFIX.len()], BEARER_PREFIX)
            || !constant_time_equal(&bytes[BEARER_PREFIX.len()..], &self.control_token)
        {
            return Err(AuthenticationError::Unauthorized);
        }
        Ok(())
    }
}

impl fmt::Debug for ControlPlaneAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ControlPlaneAuthority")
            .field("control_token", &"[REDACTED]")
            .finish()
    }
}

impl Drop for ControlPlaneAuthority {
    fn drop(&mut self) {
        self.control_token.fill(0);
    }
}

#[derive(Debug, Error)]
pub enum AuthenticationError {
    #[error("runtime control token configuration is invalid")]
    InvalidControlToken,
    #[error("runtime control request is unauthorized")]
    Unauthorized,
    #[error(transparent)]
    InvalidAuthenticatedContext(#[from] StoreError),
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    let maximum = left.len().max(right.len());
    let mut difference = left.len() ^ right.len();
    for index in 0..maximum {
        let left_byte = left.get(index).copied().unwrap_or(0);
        let right_byte = right.get(index).copied().unwrap_or(0);
        difference |= usize::from(left_byte ^ right_byte);
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn validates_configuration_without_disclosing_the_secret() {
        assert!(matches!(
            ControlPlaneAuthority::new("too-short"),
            Err(AuthenticationError::InvalidControlToken)
        ));
        assert!(matches!(
            ControlPlaneAuthority::new(format!("{}\n", "x".repeat(32))),
            Err(AuthenticationError::InvalidControlToken)
        ));
        let authority = ControlPlaneAuthority::new(TOKEN).unwrap();
        let diagnostic = format!("{authority:?}");
        assert!(diagnostic.contains("[REDACTED]"));
        assert!(!diagnostic.contains(TOKEN));
    }

    #[test]
    fn bearer_is_required_and_compared_exactly() {
        let authority = ControlPlaneAuthority::new(TOKEN).unwrap();
        for header in [
            None,
            Some(TOKEN),
            Some("bearer 0123456789abcdef0123456789abcdef"),
            Some("Bearer 0123456789abcdef0123456789abcdeg"),
            Some("Bearer 0123456789abcdef0123456789abcdef "),
        ] {
            assert!(matches!(
                authority.verify_bearer(header),
                Err(AuthenticationError::Unauthorized)
            ));
        }
        authority
            .verify_bearer(Some(&format!("Bearer {TOKEN}")))
            .unwrap();
    }

    #[test]
    fn only_authenticated_handoff_can_mint_user_context() {
        let authority = ControlPlaneAuthority::new(TOKEN).unwrap();
        let context = authority
            .authenticate_user(
                Some(&format!("Bearer {TOKEN}")),
                42,
                Some("garden-1"),
                Some("conversation-1"),
            )
            .unwrap();
        assert_eq!(context.user_id(), Some(42));
        assert_eq!(context.garden_id(), Some("garden-1"));
        assert_eq!(context.conversation_id(), Some("conversation-1"));

        assert!(matches!(
            authority.authenticate_user(
                Some("Bearer wrong-wrong-wrong-wrong-wrong-wrong"),
                42,
                Some("garden-1"),
                None,
            ),
            Err(AuthenticationError::Unauthorized)
        ));
    }

    #[test]
    fn authenticated_scopes_still_use_core_validation() {
        let authority = ControlPlaneAuthority::new(TOKEN).unwrap();
        assert!(matches!(
            authority.authenticate_user(
                Some(&format!("Bearer {TOKEN}")),
                42,
                Some("garden with spaces"),
                None,
            ),
            Err(AuthenticationError::InvalidAuthenticatedContext(_))
        ));
        let internal = authority
            .trusted_internal_context("postiz-scheduler", None, None)
            .unwrap();
        assert_eq!(internal.user_id(), None);
    }
}
